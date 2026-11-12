/**
 * 多机器人管理接口（Web 面板用）
 *
 *   GET  /qqbot/bots   → 机器人列表（状态 + 生效模型）+ 可选模型清单
 *   POST /qqbot/bots   → { action: 'add' | 'update' | 'remove', bot }
 *
 * 写入 profile 的 cordis.patch.yml 后由宿主 HMR 重载，新配置生效；
 * appSecret 只写不回传。
 */
import { getProfileDir } from '../shared/index.js';
import { persistBots } from './persist.js';
import { slugBotId } from './config.js';
import { fetchBotIdentity } from './identity.js';

const BOTS_PATH = '/qqbot/bots';
const MAX_BODY_BYTES = 64 * 1024;
const EDITABLE = ['name', 'appId', 'appSecret', 'provider', 'model', 'preset', 'cwd', 'enabled', 'requireMention', 'access', 'groupPrompt', 'directPrompt'];

function sendJson(res, status, body) {
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end(JSON.stringify(body));
}

function trusted(req) {
    const origin = req.headers.origin;
    if (origin === undefined)
        return true;
    try {
        return new URL(origin).host === req.headers.host;
    }
    catch {
        return false;
    }
}

async function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > maxBytes)
            throw new Error('request body too large');
        chunks.push(chunk);
    }
    if (size === 0)
        throw new Error('empty request body');
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** 当前 patch 里的原始 bots（未配置时用单机器人配置播种） */
export function currentBots(config) {
    const listed = Array.isArray(config?.bots) ? config.bots.filter(bot => bot && typeof bot === 'object') : [];
    if (listed.length > 0)
        return listed.map(bot => ({ ...bot }));
    if (config?.appId && config?.appSecret) {
        return [{
            id: 'default',
            name: 'QQ 机器人',
            appId: config.appId,
            appSecret: config.appSecret,
            enabled: true,
            ...(config.provider ? { provider: config.provider } : {}),
            ...(config.model ? { model: config.model } : {}),
            ...(config.preset ? { preset: config.preset } : {}),
            ...(config.requireMention !== undefined ? { requireMention: config.requireMention } : {}),
            ...(config.access ? { access: config.access } : {}),
        }];
    }
    return [];
}

/** 只接受白名单字段；空字符串视为「清除该覆盖」 */
function sanitize(input) {
    const out = {};
    if (!input || typeof input !== 'object')
        return out;
    for (const key of EDITABLE) {
        const value = input[key];
        if (value === undefined)
            continue;
        if (key === 'enabled' || key === 'requireMention') {
            out[key] = Boolean(value);
            continue;
        }
        if (key === 'access') {
            if (value && typeof value === 'object')
                out[key] = value;
            continue;
        }
        if (typeof value !== 'string')
            continue;
        const trimmed = value.trim();
        if (key === 'appSecret') {
            if (trimmed.length > 0)
                out[key] = trimmed;
            continue;
        }
        out[key] = trimmed;
    }
    return out;
}

export function registerBotsRoutes(ctx, registry, options) {
    const { config, logger, modelResolver } = options;
    ctx.inject(['webServer'], (scoped) => {
        const webServer = scoped.webServer;
        if (webServer === undefined || typeof webServer.register !== 'function')
            return;
        const dispose = webServer.register({
            kind: 'exact',
            path: BOTS_PATH,
            handler: (req, res) => { void handle(req, res); },
        });
        scoped.effect(() => dispose, 'im-qqbot.bots-routes');
    });

    async function handle(req, res) {
        if (!trusted(req)) {
            sendJson(res, 403, { error: 'forbidden' });
            return;
        }
        if (req.method === 'GET' || req.method === 'HEAD') {
            let models = [];
            try {
                models = await modelResolver.listModels();
            }
            catch (err) {
                logger?.warn?.(`im-qqbot: 读取模型列表失败: ${err instanceof Error ? err.message : String(err)}`);
            }
            sendJson(res, 200, {
                bots: registry.snapshot(),
                models,
                configured: currentBots(config).map(bot => ({
                    id: bot.id ?? '',
                    name: bot.name ?? '',
                    appId: bot.appId ?? '',
                    enabled: bot.enabled !== false,
                    provider: bot.provider ?? '',
                    model: bot.model ?? '',
                    preset: bot.preset ?? '',
                })),
            });
            return;
        }
        if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'method not allowed' });
            return;
        }
        let body;
        try {
            body = await readJsonBody(req);
        }
        catch (err) {
            sendJson(res, 400, { ok: false, error: `无法解析请求体: ${err instanceof Error ? err.message : String(err)}` });
            return;
        }
        const action = typeof body?.action === 'string' ? body.action : '';
        const input = sanitize(body?.bot);
        const bots = currentBots(config);
        let message;
        if (action === 'sync-names') {
            let renamed = 0;
            for (const bot of bots) {
                if (bot.platform === 'weixin')
                    continue; // 微信没有官方昵称接口，改名请用重命名
                if (!bot.appId || !bot.appSecret)
                    continue;
                const identity = await fetchBotIdentity(bot.appId, bot.appSecret);
                if (identity?.name && identity.name !== bot.name) {
                    bot.name = identity.name;
                    renamed += 1;
                }
            }
            message = renamed > 0 ? `已按腾讯后台名称更新 ${renamed} 个机器人` : '名称已是最新（或凭据无法查询身份）';
        }
        else if (action === 'add') {
            if (!input.appId || !input.appSecret) {
                sendJson(res, 400, { ok: false, error: 'appId 与 appSecret 不能为空' });
                return;
            }
            const identity = await fetchBotIdentity(input.appId, input.appSecret);
            const used = new Set(bots.map(bot => String(bot.id ?? '')));
            let id = slugBotId(input.id || input.name || input.appId, `bot${bots.length + 1}`);
            let suffix = 2;
            while (used.has(id))
                id = `${slugBotId(input.id || input.name || input.appId, `bot${bots.length + 1}`).slice(0, 28)}-${suffix++}`;
            bots.push({
                id,
                name: input.name || identity?.name || id,
                appId: input.appId,
                appSecret: input.appSecret,
                enabled: input.enabled !== false,
                ...(input.provider ? { provider: input.provider } : {}),
                ...(input.model ? { model: input.model } : {}),
                ...(input.preset ? { preset: input.preset } : {}),
            });
        }
        else if (action === 'rename') {
            const target = String(body?.id ?? '');
            const name = String(body?.name ?? '').trim();
            if (name === '') {
                sendJson(res, 400, { ok: false, error: '名称不能为空' });
                return;
            }
            const index = bots.findIndex(bot => String(bot.id ?? '') === target);
            if (index < 0) {
                sendJson(res, 404, { ok: false, error: `未找到机器人 ${target || '(空)'}` });
                return;
            }
            bots[index] = { ...bots[index], name };
            const entry = registry.get(target);
            if (entry)
                entry.name = name;
        }
        else if (action === 'update' || action === 'remove') {
            const target = String(body?.id ?? body?.bot?.id ?? '');
            const index = bots.findIndex(bot => String(bot.id ?? '') === target);
            if (index < 0) {
                sendJson(res, 404, { ok: false, error: `未找到机器人 ${target || '(空)'}` });
                return;
            }
            if (action === 'remove') {
                if (bots.length <= 1) {
                    sendJson(res, 409, { ok: false, error: '至少要保留一个机器人' });
                    return;
                }
                bots.splice(index, 1);
            }
            else {
                const merged = { ...bots[index], ...input };
                // 空字符串 = 清除该覆盖（回落到宿主默认模型）
                for (const key of ['provider', 'model', 'preset']) {
                    if (input[key] === '')
                        delete merged[key];
                }
                if (input.appId === '')
                    merged.appId = bots[index].appId;
                bots[index] = merged;
            }
        }
        else {
            sendJson(res, 400, { ok: false, error: `未知操作: ${action || '(空)'}` });
            return;
        }
        const isSync = action === 'sync-names';
        // 模型/preset 变更不必等重载：直接改活配置，新会话立即用新路由
        let live = false;
        if (action === 'update') {
            const target = String(body?.id ?? body?.bot?.id ?? '');
            const entry = registry.get(target);
            if (entry) {
                for (const key of ['provider', 'model', 'preset']) {
                    const value = input[key];
                    if (value === undefined)
                        continue;
                    if (value === '')
                        delete entry.config[key];
                    else
                        entry.config[key] = value;
                }
                live = true;
            }
        }
        const profileDir = getProfileDir() ?? undefined;
        if (!profileDir) {
            sendJson(res, 500, { ok: false, error: '没定位到 DSH profile 目录（DSH_PROFILE_DIR 未设置且无法从安装路径推断），无法写入 cordis.patch.yml' });
            return;
        }
        const persisted = persistBots(bots, profileDir, logger);
        if (!persisted) {
            sendJson(res, 500, { ok: false, error: '写入 cordis.patch.yml 失败（原文件已保留）；宿主日志里有具体原因' });
            return;
        }
        // 镜像到内存：连续两次写入（尚未等到 HMR 重载）时，第二次不会基于旧列表覆盖前一次
        config.bots = bots;
        sendJson(res, 200, {
            ok: true,
            message: message ?? (action === 'update'
                ? (live ? '已保存；新会话立即使用新模型' : '已保存；重载后生效')
                : action === 'rename' ? '名称已更新' : isSync ? '已保存' : '已保存；插件重载后生效'),
        });
    }
}

/**
 * 工作目录选择：调用宿主的 ctx.directoryPicker（Desktop 是原生 NSOpenPanel）。
 * 单独注册是为了不把 directoryPicker 变成机器人接口的硬依赖——
 * 远程/无原生选择器时该路由不存在，面板按钮自动隐藏。
 */
export function registerBotsPickerRoute(ctx, options) {
    const { logger } = options;
    ctx.inject(['webServer', 'directoryPicker'], (scoped) => {
        const webServer = scoped.webServer;
        const picker = scoped.directoryPicker;
        if (webServer === undefined || typeof webServer.register !== 'function')
            return;
        const dispose = webServer.register({
            kind: 'exact',
            path: '/qqbot/bots/pick-dir',
            handler: (req, res) => { void handle(req, res, picker); },
        });
        scoped.effect(() => dispose, 'qqbot-multi.pick-dir');
    });

    async function handle(req, res, picker) {
        if (!trusted(req)) {
            sendJson(res, 403, { error: 'forbidden' });
            return;
        }
        if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'method not allowed' });
            return;
        }
        req.resume();
        let capability;
        try {
            capability = picker?.capability?.();
        }
        catch (err) {
            sendJson(res, 500, { ok: false, error: `读取目录选择器失败: ${err instanceof Error ? err.message : String(err)}` });
            return;
        }
        if (capability === undefined) {
            sendJson(res, 503, { ok: false, error: '宿主未提供目录选择器' });
            return;
        }
        if (capability.kind !== 'native') {
            sendJson(res, 501, { ok: false, error: `当前目录选择器为 ${String(capability.kind)} 模式，面板暂只支持原生选择器` });
            return;
        }
        try {
            const path = await capability.pick(AbortSignal.timeout(10 * 60 * 1000));
            if (path === null || path === undefined) {
                sendJson(res, 200, { ok: true, cancelled: true });
                return;
            }
            sendJson(res, 200, { ok: true, path: String(path) });
        }
        catch (err) {
            logger?.warn?.(`dsh-qqbot-multi: 目录选择失败: ${err instanceof Error ? err.message : String(err)}`);
            sendJson(res, 500, { ok: false, error: `目录选择失败: ${err instanceof Error ? err.message : String(err)}` });
        }
    }
}

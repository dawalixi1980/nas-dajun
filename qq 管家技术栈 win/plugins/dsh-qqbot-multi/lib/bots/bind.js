/**
 * 扫码绑定接口 — 在面板里直接给机器人扫码绑定/更换凭据。
 *
 * 复用官方 QQBot connector 的扫码流程（BindingService）：轮询只在宿主执行，
 * appSecret 不出宿主进程；面板只读投影（相控 + 二维码 SVG data URL）。
 *
 *   GET  /qqbot/bots/bind  → { phase, url?, qrSvg?, savedBot? }
 *   POST /qqbot/bots/bind  → { action: 'start' | 'refresh' | 'cancel', id? }
 *
 * 扫码成功后凭据写入 cordis.patch.yml 的 bots[]，宿主 HMR 重载后自动连接。
 */
import { BindingService } from '../setup/binding-service.js';
import { getProfileDir } from '../shared/index.js';
import { PLUGIN_HOME } from '../shared/dirs.js';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { persistBots } from './persist.js';
import { currentBots } from './routes.js';
import { slugBotId } from './config.js';
import { fetchBotIdentity } from './identity.js';

/** 自动生成的占位名（扫码/默认命名），有真实名称时可覆盖 */
function isPlaceholderName(name) {
    return typeof name !== 'string' || name.trim() === '' || /^QQ\s*机器人/.test(name.trim());
}

const BIND_PATH = '/qqbot/bots/bind';
/** 绑定成功标记：写盘留存，插件重载（HMR）后仍能在面板回显「已绑定」 */
const MARKER_PATH = join(PLUGIN_HOME, 'last-bind.json');

function writeMarker(saved) {
    try {
        mkdirSync(PLUGIN_HOME, { recursive: true });
        writeFileSync(MARKER_PATH, JSON.stringify({ ...saved, at: Date.now() }, null, 2), 'utf8');
    }
    catch { /* 标记只是回显，失败不影响绑定 */ }
}

function readMarker() {
    try {
        if (!existsSync(MARKER_PATH))
            return null;
        const data = JSON.parse(readFileSync(MARKER_PATH, 'utf8'));
        return data && typeof data === 'object' && data.appId ? data : null;
    }
    catch {
        return null;
    }
}

function clearMarker() {
    try {
        rmSync(MARKER_PATH, { force: true });
    }
    catch { /* ignore */ }
}

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
        const host = new URL(origin).host;
        if (host === req.headers.host)
            return true;
        // 本机访问时 localhost 与 127.0.0.1 视为同一来源
        const loopback = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
        const name = value => String(value ?? '').replace(/:\d+$/, '');
        const port = value => (String(value ?? '').match(/:(\d+)$/) ?? [])[1] ?? '';
        // 只有「同端口」且「双方都是回环地址」才放行，避免同机其他端口伪造
        return loopback.has(name(host))
            && loopback.has(name(req.headers.host))
            && port(host) === port(req.headers.host);
    }
    catch {
        return false;
    }
}

async function readJsonBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > 64 * 1024)
            throw new Error('request body too large');
        chunks.push(chunk);
    }
    if (size === 0)
        return {};
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** 给新机器人起个不重名的默认名（AppID 后四位最直观） */
function botLabel(appId, list) {
    const base = `QQ 机器人 ${String(appId).slice(-4)}`;
    const used = new Set(list.map(bot => String(bot.name ?? '')));
    let name = base;
    let i = 2;
    while (used.has(name))
        name = `${base}-${i++}`;
    return name;
}

/** 把扫码得到的凭据写进机器人列表：优先更新目标机器人，否则按 appId 去重后新增 */
function applyCredentials(bots, credentials, targetId, identity) {
    const list = bots.map(bot => ({ ...bot }));
    const name = identity?.name && identity.name.trim() !== '' ? identity.name.trim() : '';
    const target = targetId ? list.find(bot => String(bot.id ?? '') === targetId) : undefined;
    if (target) {
        target.appId = credentials.appId;
        target.appSecret = credentials.appSecret;
        target.enabled = true;
        if (name && isPlaceholderName(target.name))
            target.name = name;
        return { bots: list, saved: { id: String(target.id), appId: credentials.appId, updated: true, name: target.name } };
    }
    const existing = list.find(bot => String(bot.appId ?? '') === credentials.appId);
    if (existing) {
        existing.appSecret = credentials.appSecret;
        existing.enabled = true;
        if (name && isPlaceholderName(existing.name))
            existing.name = name;
        return { bots: list, saved: { id: String(existing.id), appId: credentials.appId, updated: true, name: existing.name } };
    }
    const used = new Set(list.map(bot => String(bot.id ?? '')));
    let id = slugBotId(credentials.appId, `bot${list.length + 1}`);
    let suffix = 2;
    while (used.has(id))
        id = `${id.slice(0, 26)}-${suffix++}`;
    list.push({
        id,
        name: name || botLabel(credentials.appId, list),
        appId: credentials.appId,
        appSecret: credentials.appSecret,
        enabled: true,
    });
    return { bots: list, saved: { id, appId: credentials.appId, updated: false } };
}

export function registerBotsBindRoutes(ctx, options) {
    const { config, logger } = options;
    let service = null;
    let targetId = '';
    let savedBot = null;
    let lastError = null;

    const stop = () => {
        service?.dispose();
        service = null;
    };

    ctx.effect(() => () => stop(), 'qqbot-multi.bind');

    const start = (id) => {
        // 扫码成功后要等身份查询，保存是异步的：状态由轮询收敛
        stop();
        savedBot = null;
        lastError = null;
        targetId = typeof id === 'string' ? id : '';
        service = new BindingService({ source: 'dsh-qqbot-multi', logger });
        void service.start().then(async (credentials) => {
            if (!credentials)
                return;
            try {
                const profileDir = getProfileDir() ?? undefined;
                if (!profileDir) {
                    lastError = '扫码成功，但没定位到 DSH profile 目录（DSH_PROFILE_DIR 未设置且无法从安装路径推断），无法写入 cordis.patch.yml';
                    return;
                }
                // 取腾讯后台的机器人昵称作为显示名（失败则回退占位名）
                const identity = await fetchBotIdentity(credentials.appId, credentials.appSecret);
                const { bots, saved } = applyCredentials(currentBots(config), credentials, targetId, identity);
                if (persistBots(bots, profileDir, logger)) {
                    config.bots = bots;
                    savedBot = saved;
                    writeMarker(saved);
                    logger.info?.(`dsh-qqbot-multi: 扫码绑定成功 appId=${credentials.appId}（${saved.updated ? '更新' : '新增'} ${saved.id}）`);
                }
                else {
                    lastError = '扫码成功，但写入 cordis.patch.yml 失败（原文件已保留）；常见原因是文件被其他程序同时修改或格式不合法，宿主日志里有具体原因';
                }
            }
            catch (err) {
                lastError = `扫码成功，但保存失败: ${err instanceof Error ? err.message : String(err)}`;
            }
        }).catch((err) => {
            lastError = err instanceof Error ? err.message : String(err);
            logger.warn?.(`dsh-qqbot-multi: 扫码绑定失败: ${lastError}`);
        });
    };

    const wireState = () => {
        if (service === null && savedBot === null) {
            const marker = readMarker();
            if (marker !== null) {
                return { phase: 'saved', target: '', savedBot: { id: marker.id, appId: marker.appId, updated: Boolean(marker.updated) } };
            }
        }
        const base = service === null ? { phase: 'idle' } : service.wireState();
        return {
            ...base,
            target: targetId,
            savedBot: savedBot ?? (service === null ? readMarker() : null),
            ...(lastError === null ? {} : { error: lastError }),
        };
    };

    ctx.inject(['webServer'], (scoped) => {
        const webServer = scoped.webServer;
        if (webServer === undefined || typeof webServer.register !== 'function')
            return;
        const dispose = webServer.register({
            kind: 'exact',
            path: BIND_PATH,
            handler: (req, res) => { void handle(req, res); },
        });
        scoped.effect(() => dispose, 'qqbot-multi.bind-routes');
    });

    async function handle(req, res) {
        if (!trusted(req)) {
            sendJson(res, 403, { error: 'forbidden' });
            return;
        }
        if (req.method === 'GET' || req.method === 'HEAD') {
            sendJson(res, 200, wireState());
            return;
        }
        if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'method not allowed' });
            return;
        }
        let body = {};
        try {
            body = await readJsonBody(req);
        }
        catch (err) {
            sendJson(res, 400, { ok: false, error: `无法解析请求体: ${err instanceof Error ? err.message : String(err)}` });
            return;
        }
        const action = typeof body?.action === 'string' ? body.action : 'start';
        if (action === 'start') {
            clearMarker();
            start(body?.id);
            sendJson(res, 200, { ok: true, ...wireState() });
            return;
        }
        if (action === 'refresh') {
            if (service === null) {
                sendJson(res, 409, { ok: false, error: '当前没有进行中的扫码会话' });
                return;
            }
            service.refresh();
            sendJson(res, 200, { ok: true, ...wireState() });
            return;
        }
        if (action === 'dismiss') {
            clearMarker();
            savedBot = null;
            sendJson(res, 200, { ok: true, ...wireState() });
            return;
        }
        if (action === 'cancel') {
            stop();
            targetId = '';
            savedBot = null;
            lastError = null;
            sendJson(res, 200, { ok: true, ...wireState() });
            return;
        }
        sendJson(res, 400, { ok: false, error: `未知操作: ${action}` });
    }
}

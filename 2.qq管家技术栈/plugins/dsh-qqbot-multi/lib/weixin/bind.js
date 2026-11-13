/**
 * 微信扫码绑定（腾讯 iLink Bot，官方 openclaw-weixin 协议）
 *
 *   GET  /qqbot/bots/weixin        → 扫码状态（qr / scaned / verify / bound / saved / error）
 *   POST /qqbot/bots/weixin        → { action: 'start' | 'cancel' | 'verify' | 'dismiss', code? }
 *
 * 流程：get_bot_qrcode 拿二维码 → 轮询 get_qrcode_status → confirmed 时得到
 * bot_token + baseurl → 写入 bots[]（platform: weixin）→ HMR 重载后开长轮询。
 *
 * 平台前提：手机微信账号需要已获得「微信机器人」入口（我 → 设置 → 插件），
 * 腾讯分批开放；没有入口时扫码会失败或连不上，这一点插件无法绕过。
 */
import QRCode from 'qrcode';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWeixinApi, normalizeWeixinApiBaseUrl, WEIXIN_QR_BASE_URL } from './api.js';
import { getProfileDir } from '../shared/index.js';
import { PLUGIN_HOME } from '../shared/dirs.js';
import { persistBots } from '../bots/persist.js';
import { currentBots } from '../bots/routes.js';
import { slugBotId } from '../bots/config.js';

const BIND_PATH = '/qqbot/bots/weixin';
const MARKER_PATH = join(PLUGIN_HOME, 'last-weixin-bind.json');

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

function writeMarker(bot) {
    try {
        mkdirSync(PLUGIN_HOME, { recursive: true });
        writeFileSync(MARKER_PATH, JSON.stringify({ ...bot, at: Date.now() }, null, 2), 'utf8');
    }
    catch { /* 仅回显用 */ }
}

function readMarker() {
    try {
        if (!existsSync(MARKER_PATH))
            return null;
        const data = JSON.parse(readFileSync(MARKER_PATH, 'utf8'));
        return data && typeof data === 'object' && data.id ? data : null;
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

export function registerWeixinBindRoutes(ctx, options) {
    const { config, logger } = options;
    const api = createWeixinApi({});
    let session = null;
    let saved = null;
    let targetId = '';

    const stop = () => {
        session?.controller?.abort();
        session = null;
    };
    ctx.effect(() => () => stop(), 'qqbot-multi.weixin-bind');

    const state = () => {
        if (session !== null) {
            return {
                phase: session.phase,
                ...(session.qrDataUrl ? { qrDataUrl: session.qrDataUrl } : {}),
                ...(session.message ? { message: session.message } : {}),
                ...(session.bot ? { bot: session.bot } : {}),
            };
        }
        if (saved !== null)
            return { phase: 'saved', bot: saved };
        const marker = readMarker();
        return marker === null ? { phase: 'idle' } : { phase: 'saved', bot: marker };
    };

    const begin = async (id) => {
        stop();
        saved = null;
        targetId = typeof id === 'string' ? id : '';
        clearMarker();
        const controller = new AbortController();
        session = { phase: 'starting', qrDataUrl: null, message: '', controller, qrcode: '', verifyCode: '', bot: null };
        try {
            const login = await api.beginLogin({ signal: controller.signal });
            if (controller.signal.aborted)
                return;
            session.qrcode = login.qrcode;
            session.qrDataUrl = await QRCode.toDataURL(login.qrcodeUrl, { width: 280, margin: 1, errorCorrectionLevel: 'M' });
            session.phase = 'qr';
            void pollLoop(controller);
        }
        catch (err) {
            if (controller.signal.aborted)
                return;
            session.phase = 'error';
            session.message = err instanceof Error ? err.message : String(err);
            logger?.warn?.(`dsh-qqbot-multi: 微信二维码获取失败: ${session.message}`);
        }
    };

    const pollLoop = async (controller) => {
        while (!controller.signal.aborted && session !== null && session.controller === controller) {
            let res;
            try {
                res = await api.pollLogin({
                    qrcode: session.qrcode,
                    ...(session.verifyCode ? { verifyCode: session.verifyCode } : {}),
                    signal: controller.signal,
                });
            }
            catch (err) {
                if (controller.signal.aborted)
                    return;
                session.phase = 'error';
                session.message = err instanceof Error ? err.message : String(err);
                return;
            }
            if (controller.signal.aborted || session === null)
                return;
            session.verifyCode = '';
            const status = res?.status;
            if (status === 'confirmed') {
                await complete(res);
                return;
            }
            if (status === 'expired') {
                session.phase = 'expired';
                session.message = '二维码已过期，点「刷新二维码」重新获取';
                return;
            }
            if (status === 'scaned_but_redirect') {
                session.phase = 'scaned';
                session.message = '已扫码，正在切换服务节点…';
                continue;
            }
            if (status === 'scaned') {
                session.phase = 'scaned';
                session.message = '已扫码，请在手机上点击确认';
                continue;
            }
            if (status === 'need_verifycode') {
                session.phase = 'verify';
                session.message = '手机显示了一组配对数字，请在下方输入';
                continue;
            }
            if (status === 'verify_code_blocked') {
                session.phase = 'error';
                session.message = '配对数字错误次数过多，请刷新二维码重试';
                return;
            }
            if (status === 'binded_redirect') {
                session.phase = 'error';
                session.message = '该微信账号已绑定过机器人，请先在微信里解绑后重试';
                return;
            }
        }
    };

    const complete = async (res) => {
        const botToken = typeof res?.bot_token === 'string' ? res.bot_token.trim() : '';
        if (!botToken) {
            session.phase = 'error';
            session.message = '微信没有返回机器人 token（账号可能尚未获得「微信机器人」功能）';
            return;
        }
        let baseUrl = WEIXIN_QR_BASE_URL;
        try {
            baseUrl = normalizeWeixinApiBaseUrl(res?.baseurl ?? WEIXIN_QR_BASE_URL);
        }
        catch { /* 用默认 */ }
        const ilinkBotId = typeof res?.ilink_bot_id === 'string' ? res.ilink_bot_id : '';
        const bots = currentBots(config);
        let index = targetId === '' ? -1 : bots.findIndex(bot => String(bot.id ?? '') === targetId);
        if (index < 0) {
            index = bots.findIndex(bot => bot.platform === 'weixin' && (String(bot.botToken ?? '') === botToken || (ilinkBotId && String(bot.id ?? '') === ilinkBotId)));
        }
        const record = {
            name: '微信机器人',
            platform: 'weixin',
            botToken,
            baseUrl,
            enabled: true,
        };
        if (index >= 0) {
            bots[index] = { ...bots[index], ...record, platform: 'weixin' };
        }
        else {
            const used = new Set(bots.map(bot => String(bot.id ?? '')));
            let id = slugBotId(ilinkBotId || `weixin-${Date.now()}`, 'weixin');
            let suffix = 2;
            while (used.has(id))
                id = `${id.slice(0, 26)}-${suffix++}`;
            bots.push({ id, ...record });
        }
        const target = index >= 0 ? bots[index] : bots.at(-1);
        const profileDir = getProfileDir() ?? undefined;
        if (!profileDir) {
            session.phase = 'error';
            session.message = '没定位到 DSH profile 目录，无法写入 cordis.patch.yml';
            return;
        }
        if (!persistBots(bots, profileDir, logger)) {
            session.phase = 'error';
            session.message = '扫码成功，但写入 cordis.patch.yml 失败（原文件已保留）';
            return;
        }
        config.bots = bots;
        saved = { id: String(target.id), name: String(target.name ?? '') };
        writeMarker(saved);
        session.bot = saved;
        session.phase = 'bound';
        logger?.info?.(`dsh-qqbot-multi: 微信机器人绑定成功（${target.id}），插件重载后开始收发`);
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
        scoped.effect(() => dispose, 'qqbot-multi.weixin-bind-routes');
    });

    async function handle(req, res) {
        if (!trusted(req)) {
            sendJson(res, 403, { error: 'forbidden' });
            return;
        }
        if (req.method === 'GET' || req.method === 'HEAD') {
            sendJson(res, 200, state());
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
            await begin(body?.id);
            sendJson(res, 200, { ok: true, ...state() });
            return;
        }
        if (action === 'verify') {
            if (session === null || typeof body?.code !== 'string' || body.code.trim() === '') {
                sendJson(res, 400, { ok: false, error: '没有进行中的扫码会话或配对数字为空' });
                return;
            }
            session.verifyCode = body.code.trim();
            session.message = '配对数字已提交，等待确认…';
            sendJson(res, 200, { ok: true, ...state() });
            return;
        }
        if (action === 'cancel') {
            stop();
            saved = null;
            sendJson(res, 200, { ok: true, ...state() });
            return;
        }
        if (action === 'dismiss') {
            clearMarker();
            saved = null;
            sendJson(res, 200, { ok: true, phase: 'idle' });
            return;
        }
        sendJson(res, 400, { ok: false, error: `未知操作: ${action}` });
    }
}

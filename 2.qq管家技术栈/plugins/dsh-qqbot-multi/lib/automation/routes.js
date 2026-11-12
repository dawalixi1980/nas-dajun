/**
 * 自动化任务接口（面板用）
 *
 *   GET  /qqbot/automation                → { tasks, bots }
 *   POST /qqbot/automation                → { action: add|update|remove|toggle|run, task?, id?, enabled? }
 */
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

async function readJsonBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > 256 * 1024)
            throw new Error('request body too large');
        chunks.push(chunk);
    }
    if (size === 0)
        return {};
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function registerAutomationRoutes(ctx, options) {
    const { engine, registry } = options;
    ctx.inject(['webServer'], (scoped) => {
        const webServer = scoped.webServer;
        if (webServer === undefined || typeof webServer.register !== 'function')
            return;
        const dispose = webServer.register({
            kind: 'exact',
            path: '/qqbot/automation',
            handler: (req, res) => { void handle(req, res); },
        });
        scoped.effect(() => dispose, 'qqbot-multi.automation-routes');
    });

    const snapshot = () => ({
        tasks: engine.list(),
        bots: registry.list().map(entry => ({
            id: entry.id,
            name: entry.name,
            platform: entry.config.platform === 'weixin' ? 'weixin' : 'qqbot',
            ready: Boolean(entry.ready),
        })),
    });

    async function handle(req, res) {
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
        let body = {};
        try {
            body = await readJsonBody(req);
        }
        catch (err) {
            sendJson(res, 400, { ok: false, error: `无法解析请求体: ${err instanceof Error ? err.message : String(err)}` });
            return;
        }
        const action = typeof body?.action === 'string' ? body.action : '';
        if (action === 'add' || action === 'update') {
            const result = engine.upsert(body.task ?? {});
            sendJson(res, result.ok ? 200 : 400, { ...result, ...snapshot() });
            return;
        }
        if (action === 'remove') {
            const result = engine.remove(String(body?.id ?? ''));
            sendJson(res, result.ok ? 200 : 404, { ...result, ...snapshot() });
            return;
        }
        if (action === 'toggle') {
            const result = engine.toggle(String(body?.id ?? ''), body?.enabled !== false);
            sendJson(res, result.ok ? 200 : 404, { ...result, ...snapshot() });
            return;
        }
        if (action === 'run') {
            const task = engine.tasks.find(item => item.id === String(body?.id ?? ''));
            if (!task) {
                sendJson(res, 404, { ok: false, error: '任务不存在' });
                return;
            }
            void engine.run(task, undefined);
            sendJson(res, 200, { ok: true, message: '已触发（结果写入任务状态）', ...snapshot() });
            return;
        }
        sendJson(res, 400, { ok: false, error: `未知操作: ${action || '(空)'}` });
    }
}

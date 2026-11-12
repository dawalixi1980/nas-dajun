/**
 * 多机器人配置归一化
 *
 * 顶层字段是「所有机器人的默认值」，`bots[]` 里每一项覆盖同名字段。
 * 凭据（appId/appSecret）不从顶层继承到 bots 项——否则新增的机器人会
 * 悄悄复用同一个 AppID，两个连接抢同一个客户端。
 */

/** 把任意字符串收敛成 URL/工具参数安全的 id */
export function slugBotId(input, fallback = 'bot') {
    const slug = String(input ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32);
    return slug.length > 0 ? slug : fallback;
}

/** 只挑出显式给出的字段（空字符串视为未给出，回落到顶层默认） */
function pickDefined(source, keys) {
    const out = {};
    for (const key of keys) {
        const value = source?.[key];
        if (value === undefined || value === null)
            continue;
        if (typeof value === 'string' && value.trim() === '')
            continue;
        out[key] = value;
    }
    return out;
}

const PER_BOT_KEYS = [
    'provider', 'model', 'preset', 'cwd',
    'requireMention', 'groupPrompt', 'directPrompt', 'access',
    'textChunkLimit', 'streaming', 'sessionIdleTimeout', 'maxQueue',
    'processingTimeoutMs', 'askTimeoutMs', 'historyLimit', 'showToolResults',
    'debug', 'media', 'vision', 'sendFile',
];

/**
 * 归一化成 [{ ...effectiveConfig, id, name }]
 * @returns {{ bots: object[], warnings: string[] }}
 */
export function normalizeBots(config) {
    const warnings = [];
    const base = { ...config };
    delete base.bots;
    // 凭据不继承（见文件头注释）
    delete base.appId;
    delete base.appSecret;
    delete base.id;
    delete base.name;
    const listed = Array.isArray(config?.bots) ? config.bots.filter(bot => bot && typeof bot === 'object') : [];
    if (listed.length === 0) {
        const single = { ...config };
        delete single.bots;
        const appId = String(single.appId ?? '').trim();
        const appSecret = String(single.appSecret ?? '').trim();
        if (!appId || !appSecret)
            return { bots: [], warnings };
        single.id = 'default';
        single.name = 'QQ 机器人';
        single.listed = false;
        return { bots: [single], warnings };
    }
    const used = new Set();
    const bots = [];
    for (const [index, raw] of listed.entries()) {
        if (raw.enabled === false) {
            warnings.push(`机器人 #${index + 1} 已禁用（enabled: false），跳过`);
            continue;
        }
        const platform = String(raw.platform ?? 'qqbot').trim() === 'weixin' ? 'weixin' : 'qqbot';
        const appId = String(raw.appId ?? '').trim();
        const appSecret = String(raw.appSecret ?? '').trim();
        const botToken = String(raw.botToken ?? '').trim();
        if (platform === 'weixin' ? !botToken : !appId || !appSecret) {
            warnings.push(`机器人 #${index + 1}（${raw.name || raw.id || '未命名'}）缺少${platform === 'weixin' ? ' botToken' : ' appId/appSecret'}，跳过`);
            continue;
        }
        const label = String(raw.name ?? raw.id ?? appId).trim();
        let id = slugBotId(raw.id || raw.name || appId, `bot${index + 1}`);
        let suffix = 2;
        while (used.has(id))
            id = `${slugBotId(raw.id || raw.name || appId, `bot${index + 1}`).slice(0, 28)}-${suffix++}`;
        used.add(id);
        const merged = {
            ...base,
            ...pickDefined(raw, PER_BOT_KEYS),
            id,
            name: label || id,
            appId,
            appSecret,
            platform,
            ...(botToken ? { botToken } : {}),
            ...(raw.baseUrl ? { baseUrl: String(raw.baseUrl) } : {}),
            listed: true,
        };
        bots.push(merged);
    }
    return { bots, warnings };
}

/**
 * 机器人身份查询 — 用 AppID/AppSecret 换 access_token，再取 `/users/@me`。
 *
 * 用途：扫码绑定后把机器人自己的昵称（腾讯后台注册的名字）作为面板显示名，
 * 而不是生成「QQ 机器人 0823」这类占位名。失败一律软失败，调用方回退占位名。
 */
const TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken';
const ME_URL = 'https://api.sgroup.qq.com/users/@me';

/**
 * @returns {Promise<{ name: string, avatar: string, uin: string } | null>}
 */
export async function fetchBotIdentity(appId, appSecret, timeoutMs = 8000) {
    if (!appId || !appSecret)
        return null;
    const signal = AbortSignal.timeout(timeoutMs);
    try {
        const tokenRes = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ appId, clientSecret: appSecret }),
            signal,
        });
        const tokenBody = await tokenRes.json().catch(() => ({}));
        const token = typeof tokenBody?.access_token === 'string' ? tokenBody.access_token : '';
        if (!token)
            return null;
        const meRes = await fetch(ME_URL, {
            headers: {
                authorization: `QQBot ${token}`,
                'x-union-appid': String(appId),
            },
            signal,
        });
        if (!meRes.ok)
            return null;
        const me = await meRes.json().catch(() => ({}));
        const name = typeof me?.username === 'string' ? me.username.trim() : '';
        if (!name)
            return null;
        const shareUrl = typeof me?.share_url === 'string' ? me.share_url : '';
        const uin = /robot_uin=(\d+)/.exec(shareUrl)?.[1] ?? '';
        return {
            name,
            avatar: typeof me?.avatar === 'string' ? me.avatar : '',
            uin,
        };
    }
    catch {
        return null;
    }
}

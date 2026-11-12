/**
 * 机器人列表持久化 — 写入 profile 的 cordis.patch.yml `im-qqbot` 条目。
 *
 * 复用 setup/persist.js 的事务式编辑（文档保真 / fail-closed / 原子写 /
 * 读回校验），只替换 `bots` 这一个键，凭据与其它字段原样保留。
 * 写入后由宿主 HMR 重载：新 fiber 按新的机器人列表连接。
 */
import { resolve } from 'node:path';
import { isSeq } from 'yaml';
import { editProfilePatch } from '../setup/persist.js';

/** 只保留 schema 认识的字段，避免把运行时内部标记写进 profile */
function cleanBot(bot) {
    const platform = bot.platform === 'weixin' ? 'weixin' : 'qqbot';
    const out = {
        id: bot.id,
        name: bot.name,
        enabled: bot.enabled !== false,
        ...(platform === 'weixin' ? { platform } : {}),
    };
    if (platform === 'weixin') {
        if (bot.botToken)
            out.botToken = bot.botToken;
        if (bot.baseUrl)
            out.baseUrl = bot.baseUrl;
    }
    else {
        out.appId = bot.appId;
        out.appSecret = bot.appSecret;
    }
    for (const key of ['provider', 'model', 'preset', 'cwd', 'groupPrompt', 'directPrompt']) {
        const value = bot[key];
        if (typeof value === 'string' && value.trim() !== '')
            out[key] = value;
    }
    if (bot.requireMention !== undefined)
        out.requireMention = bot.requireMention !== false;
    if (bot.access !== undefined)
        out.access = bot.access;
    return out;
}

/**
 * 用给定列表覆盖 patch 里的 bots 数组。
 * @param bots 完整的机器人配置数组（含被禁用的项）
 * @param profileDir profile 目录
 * @returns boolean 是否写入成功
 */
export function persistBots(bots, profileDir, logger) {
    const log = logger ?? console;
    if (!profileDir) {
        log.warn('未定位到 profile 目录（源码直载或非常规安装），机器人列表未保存');
        return false;
    }
    const list = bots.map(cleanBot);
    try {
        const ok = editProfilePatch(profileDir, ({ config, attached, appendEntry }) => {
            config.set('bots', list);
            if (!attached)
                appendEntry();
            return true;
        }, {}, (config) => {
            if (config === undefined)
                return false;
            const node = config.get('bots', true);
            return isSeq(node) && node.items.length === list.length;
        }, log);
        if (ok) {
            log.info(`✔ 机器人列表已保存: ${resolve(profileDir, 'cordis.patch.yml')}（${list.length} 个）`);
            log.info('  插件将自动重载');
        }
        return ok;
    }
    catch (err) {
        log.warn(`保存机器人列表失败: ${err instanceof Error ? err.message : String(err)}（原文件保留）`);
        return false;
    }
}

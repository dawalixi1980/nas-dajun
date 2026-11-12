/**
 * 机器人策略：按机器人（不是按群）决定收集与回复行为。
 *
 *   collect（静默收集）：归档全部群消息（含图片），只在被 @ 时回复
 *   off（不收集）      ：不归档任何消息，只在被 @ 时回复
 *   active（活跃）     ：归档全部群消息，每条都回复
 *
 * 存储：~/.dsh-qqbot/modes.json
 *   { "default": "collect", "bots": { "1905830497": "off" } }
 */
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN_HOME } from '../shared/dirs.js';

export const MODES_PATH = join(PLUGIN_HOME, 'modes.json');
export const MODES = ['collect', 'off', 'active'];
export const MODE_LABELS = { collect: '静默收集', off: '不收集', active: '活跃' };
const DEFAULT_MODE = 'collect';

let cache = { mtimeMs: -1, data: null };

function readAll() {
    try {
        if (!existsSync(MODES_PATH)) return { default: DEFAULT_MODE, bots: {} };
        const info = statSync(MODES_PATH);
        if (cache.mtimeMs === info.mtimeMs && cache.data) return cache.data;
        const parsed = JSON.parse(readFileSync(MODES_PATH, 'utf8'));
        const data = {
            default: MODES.includes(parsed?.default) ? parsed.default : DEFAULT_MODE,
            bots: parsed?.bots && typeof parsed.bots === 'object' ? parsed.bots : {},
        };
        cache = { mtimeMs: info.mtimeMs, data };
        return data;
    } catch {
        return { default: DEFAULT_MODE, bots: {} };
    }
}

function persist(data) {
    writeFileSync(`${MODES_PATH}.tmp`, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(`${MODES_PATH}.tmp`, MODES_PATH);
    cache = { mtimeMs: -1, data: null };
    return data;
}

export function resolveMode(botId) {
    const data = readAll();
    const value = data.bots[String(botId ?? '')];
    return MODES.includes(value) ? value : data.default;
}

export function listModes() {
    const data = readAll();
    return { default: data.default, bots: { ...data.bots } };
}

export function setBotMode(botId, mode) {
    if (!MODES.includes(mode)) throw new Error(`未知策略: ${mode}（可选 ${MODES.join(' / ')}）`);
    const data = readAll();
    return persist({ default: data.default, bots: { ...data.bots, [String(botId)]: mode } });
}

export function setDefaultMode(mode) {
    if (!MODES.includes(mode)) throw new Error(`未知策略: ${mode}`);
    const data = readAll();
    return persist({ default: mode, bots: { ...data.bots } });
}

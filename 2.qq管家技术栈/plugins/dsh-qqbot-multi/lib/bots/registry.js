/**
 * 机器人注册表：把「哪条入站消息属于哪个机器人」的判定集中到一处。
 *
 * 全局工具（qqbot_send_file 等）在宿主只注册一次，执行时按
 * `bot` 参数 → 当前 agent 所属会话 → 单机器人兜底 的顺序定位目标机器人。
 */
export class BotRegistry {
    entries = new Map();
    logger;
    constructor(logger) {
        this.logger = logger;
    }
    add(entry) {
        this.entries.set(entry.id, entry);
        return entry;
    }
    remove(id) {
        this.entries.delete(id);
    }
    get(id) {
        return this.entries.get(id);
    }
    has(id) {
        return this.entries.has(id);
    }
    list() {
        return [...this.entries.values()];
    }
    ids() {
        return [...this.entries.keys()];
    }
    /** 该 agent 属于哪个机器人（多机器人下由各 manager 的会话表判定） */
    fromAgent(agent) {
        if (!agent)
            return undefined;
        for (const entry of this.entries.values()) {
            try {
                if (entry.manager?.findByAgent?.(agent))
                    return entry;
            }
            catch { /* 会话表异常不影响其它机器人 */ }
        }
        return undefined;
    }
    /**
     * 定位工具调用要操作的机器人。
     * @param explicit 显式 bot 参数（id 或名称）
     * @param exec 工具执行上下文
     */
    pick(explicit, exec) {
        if (explicit !== undefined && explicit !== null && String(explicit).trim() !== '') {
            const key = String(explicit).trim();
            const direct = this.entries.get(key);
            if (direct)
                return direct;
            const byName = this.list().find(entry => entry.name === key);
            if (byName)
                return byName;
            throw new Error(`未知机器人: ${key}（可用: ${this.ids().join(', ') || '无'}）`);
        }
        const byAgent = this.fromAgent(exec?.agent);
        if (byAgent)
            return byAgent;
        const all = this.list();
        if (all.length === 1)
            return all[0];
        if (all.length === 0)
            throw new Error('当前没有已连接的 QQ 机器人');
        throw new Error(`当前会话不属于任何 QQ 机器人；请用 bot 参数指定（可用: ${this.ids().join(', ')}）`);
    }
    /** 面板/状态接口用的投影（appSecret 永不回传） */
    snapshot() {
        return this.list().map(entry => ({
            id: entry.id,
            name: entry.name,
            platform: entry.config.platform === 'weixin' ? 'weixin' : 'qqbot',
            appId: entry.config.appId,
            ready: Boolean(entry.ready),
            listed: Boolean(entry.config.listed),
            provider: entry.config.provider ?? '',
            model: entry.config.model ?? '',
            preset: entry.config.preset ?? '',
            cwd: entry.config.cwd ?? '',
            requireMention: entry.config.requireMention !== false,
            sessions: entry.manager?.sessions?.size ?? entry.sessions?.size ?? 0,
        }));
    }
}

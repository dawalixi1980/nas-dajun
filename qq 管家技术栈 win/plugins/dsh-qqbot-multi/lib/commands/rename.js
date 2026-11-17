import { getArchiveApi } from '../archive2/index.js';

/**
 * /rename —— 给群聊归档文件夹改名。
 *
 *   群聊里：/rename 新名称            → 改当前群
 *   任意处：/rename 编号 新名称       → 按 /groups 的编号改
 */
export function renameCommand({ config }) {
    return {
        name: 'rename',
        category: 'qqbot',
        scope: 'all',
        description: '给群聊的归档文件夹改名',
        usage: [
            '/rename 新施工测试1群        （在群里：改当前群）',
            '/rename 2 新施工测试1群     （任意位置：按编号改）',
            '',
            '先发 /groups 查看编号。',
        ].join('\n'),
        async handler(cmdCtx) {
            const api = getArchiveApi();
            if (api === null) return '⚠️ 归档服务还没就绪，稍后再试';

            const raw = String(cmdCtx.command?.raw ?? '').trim();
            if (raw === '') {
                return '用法：群里发 /rename 群名；私聊先发 /groups 看编号，再发 /rename 编号 群名';
            }

            const snapshot = api.snapshot();
            const groups = (snapshot.groups || []).filter(item => item.botId === config.id);
            if (groups.length === 0) return '还没有归档任何群，先在群里收一条消息。';

            const tokens = raw.split(/\s+/);
            const inGroup = cmdCtx.message?.kind === 'group';
            let target = null;
            let name = raw;

            // 形如「2 新名称」→ 按编号
            if (/^\d+$/.test(tokens[0]) && tokens.length > 1) {
                const index = Number(tokens[0]) - 1;
                if (index < 0 || index >= groups.length) {
                    return `⚠️ 编号 ${tokens[0]} 超出范围（共 ${groups.length} 个群）`;
                }
                target = groups[index];
                name = tokens.slice(1).join(' ');
            }
            else if (inGroup) {
                const openid = cmdCtx.message?.groupOpenid ?? '';
                target = groups.find(item => item.openid === openid) ?? null;
                if (target === null) return '⚠️ 这个群还没有归档记录，先在这里发一条消息';
            }
            else {
                return '⚠️ 私聊里需要指定是哪个群：先发 /groups 看编号，再发 /rename 编号 群名';
            }

            name = name.trim();
            if (name === '') return '⚠️ 缺少新名称';

            try {
                const result = await api.rename(target.botId, target.openid, name);
                return `✅ 已改名：${result.name}\n文件夹：${result.folder}`;
            }
            catch (err) {
                return `⚠️ 改名失败：${err instanceof Error ? err.message : String(err)}`;
            }
        },
    };
}

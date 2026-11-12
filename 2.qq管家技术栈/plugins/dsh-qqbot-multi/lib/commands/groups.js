import { getArchiveApi } from '../archive2/index.js';

/**
 * /groups —— 列出当前机器人名下的所有群及其归档文件夹。
 * 编号可直接给 /rename 使用。
 */
export function groupsCommand({ config }) {
    return {
        name: 'groups',
        category: 'qqbot',
        scope: 'all',
        description: '列出这个机器人归档的所有群聊',
        usage: ['/groups', '', '列出当前机器人名下已归档的群，带编号，可用 /rename 编号 新名称 改名。'].join('\n'),
        handler() {
            const api = getArchiveApi();
            if (api === null) return '⚠️ 归档服务还没就绪，稍后再试';
            const snapshot = api.snapshot();
            const groups = (snapshot.groups || []).filter(item => item.botId === config.id);
            if (groups.length === 0) return '还没有归档任何群。让机器人先在群里收到一条消息。';
            const lines = [`归档目录：${snapshot.root}`, ''];
            groups.forEach((group, index) => {
                const name = group.name || group.folder;
                lines.push(`${index + 1}. ${name}`);
                lines.push(`   ${group.messages ?? 0} 条 ｜ ${group.openid.slice(0, 12)}…`);
            });
            lines.push('', '改名：/rename 编号 新名称');
            return lines.join('\n');
        },
    };
}

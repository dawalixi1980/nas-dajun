import { updateFromRepo } from '../archive2/updater.js';

/**
 * /update —— 从 GitHub 仓库拉取最新的「qq 管家技术栈」插件源码。
 *
 * 不经过模型：直接 git pull + 覆盖文件，几秒完成。
 */
export function updateCommand() {
    return {
        name: 'update',
        category: 'qqbot',
        scope: 'all',
        description: '从仓库更新 QQ 管家插件',
        usage: ['/update', '', '从 nas-dajun 仓库的「2.qq管家技术栈」拉取最新插件并覆盖本机。'].join('\n'),
        async handler() {
            const result = await updateFromRepo(undefined);
            if (!result.ok) return `⚠️ 更新失败：${result.error ?? '未知错误'}`;
            if (!result.changed) {
                return `✅ 已是最新版本（${result.version}）`;
            }
            const lines = [
                `✅ 已更新到 ${result.version}${result.previous ? `（原 ${result.previous}）` : ''}`,
                `更新内容：${(result.targets ?? []).join('、')}`,
            ];
            if (result.restart) lines.push('', '⚠️ 机器人插件需要重启桌面端（或禁用再启用插件）后生效');
            else lines.push('', '面板插件刷新页面即可生效');
            return lines.join('\n');
        },
    };
}

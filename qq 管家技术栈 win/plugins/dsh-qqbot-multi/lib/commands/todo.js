import { setTodoPending } from '../archive2/todo-state.js';
import { getAutomationEngine } from '../automation/tool.js';

/**
 * /todo            —— 开始创建自动化任务
 * /todo list       —— 列出当前会话的任务（带序号）
 * /todo list all   —— 列出这个机器人的全部任务
 * /todo del <序号> —— 删除（也接受任务 id）
 */
export function todoCommand({ config }) {
    return {
        name: 'todo',
        category: 'qqbot',
        scope: 'all',
        description: '创建或管理自动化定时任务',
        usage: [
            '/todo             开始创建任务',
            '/todo list        查看当前会话的任务',
            '/todo list all    查看全部任务',
            '/todo del 2       删除第 2 个',
        ].join('\n'),
        handler(cmdCtx) {
            const message = cmdCtx.message ?? {};
            const args = cmdCtx.command?.args ?? [];
            const sub = String(args[0] ?? '').toLowerCase();
            const peerId = message.groupOpenid ?? message.senderId ?? '';

            const collect = (all) => {
                const engine = getAutomationEngine();
                if (engine === null) return null;
                return engine.list()
                    .filter(task => task.action?.botId === config.id && (all || task.action?.target?.id === peerId))
                    .map((task, index) => ({ ...task, index: index + 1 }));
            };

            // ── 查看列表 ──
            if (sub === 'list' || sub === 'ls') {
                const all = String(args[1] ?? '').toLowerCase() === 'all';
                const tasks = collect(all);
                if (tasks === null) return '⚠️ 自动化服务还没就绪，稍后再试';
                if (tasks.length === 0) {
                    return all
                        ? '这个机器人还没有自动化任务。发 /todo 创建第一个。'
                        : '当前会话还没有自动化任务。发 /todo 创建，或 /todo list all 查看全部。';
                }
                const lines = [`${all ? '全部' : '当前会话'}共 ${tasks.length} 个任务：`, ''];
                for (const task of tasks) {
                    const where = task.action?.target?.kind === 'group'
                        ? `群 ${String(task.action?.target?.id ?? '').slice(0, 10)}…`
                        : '私聊';
                    lines.push(`${task.index}. ${task.enabled ? '🟢' : '⚪'} ${task.name}`);
                    lines.push(`   ${task.trigger?.cron ?? ''} ｜ 发往${where}`);
                    if (task.lastResult) lines.push(`   上次：${task.lastResult}`);
                }
                lines.push('', `删除：/todo del 序号${all ? '' : '（或 /todo list all 看全部）'}`);
                return lines.join('\n');
            }

            // ── 删除 ──
            if (sub === 'del' || sub === 'delete' || sub === 'remove') {
                const engine = getAutomationEngine();
                if (engine === null) return '⚠️ 自动化服务还没就绪';
                const raw = String(args[1] ?? '').trim();
                if (raw === '') return '用法：/todo del 序号，先用 /todo list 查看';
                const all = String(args[2] ?? '').toLowerCase() === 'all';
                const tasks = collect(all);
                if (tasks === null) return '⚠️ 自动化服务还没就绪';
                if (tasks.length === 0) return '没有可删除的任务。';

                let target = null;
                if (/^\d+$/.test(raw)) {
                    target = tasks[Number(raw) - 1] ?? null;
                    if (target === null) return `⚠️ 没有第 ${raw} 个任务（当前共 ${tasks.length} 个）`;
                }
                else {
                    target = tasks.find(task => task.id === raw) ?? null;
                    if (target === null) return `⚠️ 找不到任务 ${raw}`;
                }

                const result = engine.remove(target.id);
                return result.ok
                    ? `✅ 已删除 ${target.index}. ${target.name}`
                    : `⚠️ 删除失败：${result.error ?? '未知错误'}`;
            }

            // ── 默认：开始创建 ──
            setTodoPending(`${config.id}:${peerId}`, message.senderId ?? '');
            const inGroup = message.kind === 'group';
            return [
                '好的，要什么自动化任务？',
                '',
                '照着这样说就行：',
                inGroup
                    ? '每天早上9点，在这个群发一句今日施工安全提醒'
                    : '每天早上9点，发我一句今天的待办提醒',
                inGroup
                    ? '每周一8点，发一段本周工作安排'
                    : '每周一8点，发我一段本周工作安排',
                '',
                '时间最小1分钟一次。',
                '查看已有任务：/todo list',
            ].join('\n');
        },
    };
}

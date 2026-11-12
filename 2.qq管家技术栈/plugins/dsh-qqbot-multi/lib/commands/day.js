import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { buildDayDigest, formatDigest, listArchivedGroups, parseDayArg, todayKey } from '../archive2/day.js';

/**
 * /day             —— 总结今天这个群
 * /day 昨天        —— 总结昨天
 * /day 2026-11-11  —— 指定日期
 * /day 2           —— 私聊里按编号选群
 * /day 2 昨天      —— 编号 + 日期
 */
export function dayCommand({ config, manager, logger }) {
    return {
        name: 'day',
        category: 'qqbot',
        scope: 'all',
        description: '总结某天的群聊与工程信息',
        usage: [
            '/day             总结今天的当前群',
            '/day 昨天        昨天',
            '/day 2026-11-11  指定日期',
            '/day 群编号 日期  私聊里指定群',
        ].join('\n'),
        async handler(cmdCtx) {
            const message = cmdCtx.message ?? {};
            const args = cmdCtx.command?.args ?? [];
            const inGroup = message.kind === 'group';
            const peerId = message.groupOpenid ?? message.senderId ?? '';

            // 解析参数：日期 / 群
            let date = todayKey(0);
            let groupQuery = '';
            for (const raw of args) {
                const parsed = parseDayArg(raw);
                if (parsed !== null && groupQuery === '') {
                    date = parsed;
                    continue;
                }
                groupQuery = groupQuery === '' ? String(raw) : `${groupQuery} ${raw}`;
            }

            const groups = listArchivedGroups(config.id);

            // 目标是哪个群
            let target = null;
            if (groupQuery === '') {
                if (!inGroup) {
                    if (groups.length === 0) return '还没有归档任何群。';
                    const lines = ['要总结哪个群？回复编号即可：', ''];
                    groups.forEach((group, index) => lines.push(`${index + 1}. ${group.label}`));
                    lines.push('', '也可以直接说：/day 1 昨天');
                    return lines.join('\n');
                }
                target = groups.find(group => group.openid === peerId) ?? null;
                if (target === null) return '这个群还没有归档记录。';
            }
            else if (/^\d+$/.test(groupQuery)) {
                const index = Number(groupQuery) - 1;
                if (index < 0 || index >= groups.length) {
                    return `⚠️ 没有第 ${groupQuery} 个群（共 ${groups.length} 个）`;
                }
                target = groups[index];
            }
            else {
                target = groups.find(group =>
                    group.openid === groupQuery
                    || group.label === groupQuery
                    || group.label.replace(/\s+/g, '') === groupQuery.replace(/\s+/g, '')) ?? null;
                if (target === null) {
                    const known = groups.map(group => group.label).join('、') || '（暂无）';
                    return `⚠️ 找不到群「${groupQuery}」。已知群：${known}`;
                }
            }

            const botNames = [config.name, ...((config.bots ?? []).map(item => item.name))].filter(Boolean);
            const digest = buildDayDigest(config.id, target.openid, date, { skipSenders: botNames });
            const material = formatDigest(digest, target.label);

            if (digest.empty) return material;

            // 交给模型写成一段总结（消耗 token，但可读性远好于流水账）
            try {
                const replyTarget = cmdCtx.replyTarget ?? { scope: inGroup ? 'group' : 'c2c', targetId: peerId };
                const record = await manager.getOrCreate(
                    replyTarget.scope === 'group' ? 'group' : 'c2c',
                    replyTarget.targetId,
                    message.senderId ?? '',
                    replyTarget,
                );
                const prompt = [
                    `下面是「${target.label}」在 ${date} 的归档素材。`,
                    '请用中文写一段 120 字以内的总结，发给群里。',
                    '',
                    '要求：',
                    '1. 有工程内容时，先说什么工程、做了什么，再提花了多少钱（只写素材里出现的数字，不要编）',
                    '2. 没有工程内容时，就用两三句话概括大家聊了什么',
                    '3. 不要逐条罗列消息，不要流水账，不要表格，不要标题',
                    '4. 直接输出总结正文，不要解释你在做什么',
                    '',
                    '--- 素材 ---',
                    material,
                ].join('\n');
                record.agent.followup(createUserMessage({
                    content: [{ type: 'text', text: prompt }],
                    source: { kind: 'user' },
                }));
                return undefined;   // 命令不回复，等模型把总结发出来
            }
            catch (err) {
                logger?.warn?.(`day 命令调用模型失败: ${err instanceof Error ? err.message : String(err)}`);
                return material;
            }
        },
    };
}

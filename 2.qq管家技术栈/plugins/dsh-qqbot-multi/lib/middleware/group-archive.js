/**
 * 群消息处理 —— 按机器人策略决定「收不收集」「回不回复」。
 *
 * 执行顺序（在 @ 门控之后，所以 ctx.state.mention 已就绪）：
 *   0. /todo 待办：用户刚发过 /todo，这条消息无条件交给模型
 *   1. 斜杠命令（/rename、/id 等）→ 无条件放行，不受策略影响
 *   2. collect（静默收集）：归档 → 只有被 @ 时才继续
 *   3. off（不收集）      ：不归档 → 只有被 @ 时才继续
 *   4. active（活跃）     ：不归档 → 每条都继续
 */
import { downloadMediaAttachments } from '../transport/attachment.js';
import { appendArchive } from '../transport/archive.js';
import { resolveMode } from '../archive2/modes.js';
import { consumeTodoPending } from '../archive2/todo-state.js';

export function groupArchive(config, logger) {
    return async (ctx, next) => {
        const message = ctx.message;
        if (message === undefined || message === null) {
            await next();
            return;
        }

        const botId = String(config.id ?? '');
        const peerId = String(message.groupOpenid ?? message.senderId ?? '');
        const isGroup = message.kind === 'group';

        // ── /todo 待办：只有「非命令」的下一条消息才算任务描述 ──
        const rawContent = String(message.content ?? '');
        const isCommand = rawContent.trim().startsWith('/');
        const todoPending = isCommand ? false : consumeTodoPending(`${botId}:${peerId}`, message.senderId ?? '');
        if (todoPending) {
            try {
                message.content = `[自动化任务] ${rawContent}`;
            }
            catch { /* 不可写就保持原样 */ }
        }

        if (!isGroup) {
            await next();
            return;
        }

        // 优先用门控算好的结果；万一没有，自己扫内容兜底
        const appId = String(config.appId ?? '');
        const content = String(message.content ?? '');
        const mentioned = ctx.state?.mention !== undefined
            ? ctx.state.mention.wasMentioned === true
            : (message.rawEventType === 'GROUP_AT_MESSAGE_CREATE'
                || (Array.isArray(message.mentions) && message.mentions.some(item => item?.is_you === true))
                || (appId !== '' && new RegExp(`<@!?${appId}>`).test(content)));

        let mode = 'collect';
        try {
            mode = resolveMode(botId);
        }
        catch { /* 读不到策略就用默认 */ }

        // 除了「不收集」，其余策略都落盘（命令消息也一并记账）
        if (mode !== 'off') {
            try {
                let files = [];
                const attachments = message.attachments ?? [];
                if (attachments.length > 0 && config.media?.enabled !== false) {
                    try {
                        files = await downloadMediaAttachments(attachments, config.media, logger);
                    }
                    catch (err) {
                        logger?.warn?.(`group-archive: 媒体下载失败: ${err instanceof Error ? err.message : String(err)}`);
                    }
                }
                await appendArchive({
                    platform: 'qqbot',
                    botId,
                    botName: config.name ?? '',
                    groupOpenid: message.groupOpenid ?? '',
                    senderId: message.senderId ?? '',
                    senderName: message.senderName ?? '',
                    text: content,
                    mentioned,
                    media: attachments.map((att, index) => ({
                        contentType: att.content_type ?? '',
                        filename: att.filename ?? '',
                        localPath: files[index]?.localPath ?? '',
                        url: att.url ?? '',
                    })),
                    time: Date.now(),
                });
            }
            catch (err) {
                logger?.warn?.(`group-archive: 归档失败: ${err instanceof Error ? err.message : String(err)}`);
            }
        }

        // /todo 的任务描述：无条件交给模型
        if (todoPending) {
            await next();
            return;
        }

        // 斜杠命令：无条件放行（不受模式与 @ 限制）
        // SDK 的命令中间件在群聊里强制要求「被 @ 过」，这里补一个标记绕过它。
        if (content.trim().startsWith('/')) {
            if (!mentioned) {
                try {
                    message.mentions = Array.isArray(message.mentions) ? message.mentions : [];
                    message.mentions.push({ is_you: true });
                }
                catch { /* 不可写就交给默认逻辑 */ }
            }
            await next();
            return;
        }

        if (mode === 'collect') {
            if (mentioned) await next();
            return;
        }
        if (mode === 'active' || mentioned) await next();
    };
}

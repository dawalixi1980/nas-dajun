/**
 * 自动化引擎：时间触发（cron）+ 事件触发（收到消息），动作是「让某个机器人
 * 用自己的模型跑一段 prompt，然后把结果发出去」。
 *
 * 发送能力复用各机器人已建立的通道：
 *   - QQ：entry.sender.sendMarkdown（无 msgId 时自动降级为主动推送）
 *   - 微信：iLink sendmessage
 */
import { randomUUID } from 'node:crypto';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { parseCron } from './cron.js';
import { loadTasks, saveTasks } from './store.js';
import { resolveAgentCwd } from '../shared/dirs.js';
import { createWeixinApi, splitWeixinText, normalizeWeixinApiBaseUrl } from '../weixin/api.js';
import { resolveRoute } from '../weixin/channel.js';

const TICK_MS = 20_000;
const PERSONA = '你是自动化任务的执行器。只输出要发送给对方的最终文本：不要解释过程，不要 Markdown 标题。';

function eventsOf(session) {
    if (typeof session?.snapshotEvents === 'function')
        return session.snapshotEvents();
    return Array.isArray(session?.events) ? session.events : [];
}

function lastAssistantText(events) {
    for (let i = events.length - 1; i >= 0; i -= 1) {
        const event = events[i];
        if (event?.type !== 'assistant/message')
            continue;
        const blocks = (event.message ?? event.data?.message)?.content;
        if (!Array.isArray(blocks))
            continue;
        const text = blocks.filter(block => block?.type === 'text').map(block => block.text ?? '').join('').trim();
        if (text)
            return text;
    }
    return '';
}

export class AutomationEngine {
    constructor({ ctx, registry, logger, tasksPath }) {
        this.ctx = ctx;
        this.registry = registry;
        this.logger = logger;
        this.tasksPath = tasksPath;
        this.tasks = [];
        this.timer = undefined;
        this.running = new Set();
        this.lastMinute = '';
    }

    start() {
        this.tasks = loadTasks(this.tasksPath);
        this.timer = setInterval(() => this.tick(), TICK_MS);
        this.timer.unref?.();
        return this;
    }

    stop() {
        if (this.timer !== undefined) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }

    list() {
        return this.tasks.map(task => ({
            ...task,
            triggerText: task.trigger?.type === 'time'
                ? `时间 ${task.trigger.cron ?? ''}`
                : `事件 收到消息${task.trigger?.keyword ? `（含「${task.trigger.keyword}」）` : ''}`,
            actionText: `${task.action?.botId ?? '默认机器人'} → ${describeTarget(task.action?.target)}`,
        }));
    }

    persist() {
        const ok = saveTasks(this.tasks, this.tasksPath);
        if (!ok)
            this.logger?.warn?.('dsh-qqbot-multi: 自动化任务保存失败');
        return ok;
    }

    upsert(task) {
        const id = typeof task.id === 'string' && task.id !== '' ? task.id : `task-${randomUUID().slice(0, 8)}`;
        const record = {
            id,
            name: String(task.name ?? '').trim() || '未命名任务',
            enabled: task.enabled !== false,
            trigger: {
                type: task.trigger?.type === 'event' ? 'event' : 'time',
                cron: String(task.trigger?.cron ?? '0 9 * * *'),
                ...(task.trigger?.botId ? { botId: String(task.trigger.botId) } : {}),
                ...(task.trigger?.keyword ? { keyword: String(task.trigger.keyword) } : {}),
                ...(task.trigger?.platform === 'weixin' || task.trigger?.platform === 'qqbot' ? { platform: task.trigger.platform } : {}),
            },
            action: {
                botId: String(task.action?.botId ?? ''),
                prompt: String(task.action?.prompt ?? ''),
                target: {
                    kind: String(task.action?.target?.kind ?? 'source'),
                    id: String(task.action?.target?.id ?? ''),
                },
            },
            lastRunAt: task.lastRunAt ?? null,
            lastResult: task.lastResult ?? '',
        };
        if (record.trigger.type === 'time') {
            try {
                parseCron(record.trigger.cron);
            }
            catch (err) {
                return { ok: false, error: err instanceof Error ? err.message : String(err) };
            }
        }
        if (record.action.prompt.trim() === '')
            return { ok: false, error: '行动提示词不能为空' };
        const index = this.tasks.findIndex(item => item.id === id);
        if (index >= 0)
            this.tasks[index] = record;
        else
            this.tasks.push(record);
        return this.persist() ? { ok: true, task: record } : { ok: false, error: '保存任务文件失败' };
    }

    remove(id) {
        const before = this.tasks.length;
        this.tasks = this.tasks.filter(task => task.id !== id);
        return before === this.tasks.length ? { ok: false, error: '任务不存在' } : { ok: this.persist() };
    }

    toggle(id, enabled) {
        const task = this.tasks.find(item => item.id === id);
        if (!task)
            return { ok: false, error: '任务不存在' };
        task.enabled = enabled !== false;
        return { ok: this.persist(), task };
    }

    tick() {
        const now = new Date();
        const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
        for (const task of this.tasks) {
            if (!task.enabled || task.trigger?.type !== 'time')
                continue;
            let cron;
            try {
                cron = parseCron(task.trigger.cron);
            }
            catch {
                continue;
            }
            if (!cron.matches(now))
                continue;
            const marker = `${task.id}:${minuteKey}`;
            if (this.lastMinute.includes(marker))
                continue;
            this.lastMinute = `${this.lastMinute},${marker}`.slice(-4000);
            void this.run(task, undefined);
        }
    }

    /** 入站消息事件：由各通道在收到消息时调用 */
    onMessage(event) {
        for (const task of this.tasks) {
            if (!task.enabled || task.trigger?.type !== 'event')
                continue;
            if (task.trigger.botId && task.trigger.botId !== event.botId)
                continue;
            if (task.trigger.platform && task.trigger.platform !== event.platform)
                continue;
            if (task.trigger.keyword && !String(event.text ?? '').includes(task.trigger.keyword))
                continue;
            void this.run(task, event);
        }
    }

    async run(task, event) {
        if (this.running.has(task.id)) {
            this.logger?.info?.(`dsh-qqbot-multi: 任务 ${task.id} 还在运行，跳过本次触发`);
            return;
        }
        const entry = this.pickBot(task.action?.botId);
        if (!entry) {
            task.lastResult = '没有可用机器人（检查任务里的机器人 id）';
            this.persist();
            return;
        }
        this.running.add(task.id);
        try {
            const prompt = buildPrompt(task, event);
            const text = await this.runPrompt(entry, prompt);
            if (text === '') {
                task.lastResult = '模型没有返回文本';
            }
            else {
                await this.deliver(entry, task, event, text);
                task.lastResult = `已发送 ${text.length} 字`;
            }
        }
        catch (err) {
            task.lastResult = `失败: ${err instanceof Error ? err.message : String(err)}`;
            this.logger?.warn?.(`dsh-qqbot-multi: 任务 ${task.id} 执行失败: ${task.lastResult}`);
        }
        finally {
            this.running.delete(task.id);
            task.lastRunAt = Date.now();
            this.persist();
        }
    }

    pickBot(botId) {
        if (botId) {
            const entry = this.registry.get(botId);
            if (entry)
                return entry;
        }
        const ready = this.registry.list().find(item => item.ready);
        return ready ?? this.registry.list()[0];
    }

    async runPrompt(entry, prompt) {
        const config = entry.config;
        const route = resolveRoute(this.ctx, config);
        const created = await this.ctx.agents.create({
            sessionId: `session-${randomUUID()}`,
            meta: { cwd: resolveAgentCwd(config.cwd) },
            ...(route ? { agentOptions: route } : {}),
            setup: async (agentCtx) => {
                try {
                    agentCtx.tools?.restrict?.({ allow: [] });
                }
                catch { /* 老宿主没有 restrict */ }
                agentCtx.systemPrompt?.section?.({ name: 'automation-persona', order: 500, text: PERSONA });
            },
        });
        try {
            const session = created.agent.session;
            const beforeSeq = Number.isInteger(session?.seq) ? session.seq : eventsOf(session).length;
            created.agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }));
            const timeout = new Promise(resolve => setTimeout(() => resolve('timeout'), 180_000).unref?.());
            const finished = created.agent.whenIdle().then(() => 'idle');
            const outcome = await Promise.race([finished, timeout]);
            if (outcome === 'timeout') {
                try {
                    created.agent.cancel?.({ kind: 'user' });
                }
                catch { /* ignore */ }
            }
            const all = eventsOf(session);
            const fresh = all.some(event => Number.isInteger(event?.seq))
                ? all.filter(event => Number.isInteger(event?.seq) && event.seq > beforeSeq)
                : all.slice(beforeSeq);
            return lastAssistantText(fresh);
        }
        finally {
            void Promise.resolve(created.dispose?.()).catch(() => { });
        }
    }

    async deliver(entry, task, event, text) {
        const target = resolveTarget(task.action?.target, event);
        if (target === null)
            throw new Error('任务没有可用的发送目标（事件来源为空时需要填写目标 id）');
        if (entry.config.platform === 'weixin') {
            const baseUrl = normalizeWeixinApiBaseUrl(entry.config.baseUrl || 'https://ilinkai.weixin.qq.com/');
            const api = createWeixinApi({});
            for (const chunk of splitWeixinText(text)) {
                await api.sendText({
                    baseUrl,
                    token: String(entry.config.botToken ?? ''),
                    toUserId: target.id,
                    text: chunk,
                    signal: AbortSignal.timeout(60_000),
                });
            }
            return;
        }
        const scope = target.kind === 'group' ? 'group' : 'c2c';
        await entry.sender.sendMarkdown({ scope, targetId: target.id }, text, {});
    }
}

function describeTarget(target) {
    if (!target || target.kind === 'source' || target.kind === '')
        return '事件来源';
    if (target.kind === 'group')
        return `群 ${target.id}`;
    return `私聊 ${target.id}`;
}

function resolveTarget(target, event) {
    if (!target || target.kind === 'source' || target.kind === '') {
        if (!event)
            return null;
        return { kind: event.kind === 'group' ? 'group' : 'private', id: String(event.peerId ?? '') };
    }
    if (target.id.trim() === '')
        return null;
    return { kind: target.kind === 'group' ? 'group' : 'private', id: target.id.trim() };
}

function buildPrompt(task, event) {
    const lines = [task.action?.prompt ?? ''];
    if (event) {
        lines.push('', '--- 事件信息 ---');
        lines.push(`平台：${event.platform === 'weixin' ? '微信' : 'QQ'}`);
        lines.push(`会话：${event.kind === 'group' ? '群聊' : '私聊'} ${event.peerId}`);
        lines.push(`内容：${String(event.text ?? '').slice(0, 2000)}`);
    }
    lines.push('', `当前时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
    return lines.join('\n');
}

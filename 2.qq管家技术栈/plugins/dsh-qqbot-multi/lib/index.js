import { appendFileSync } from 'node:fs';
import { ConfigSchema } from './config.js';
import { bootstrapGateway } from './gateway/index.js';
import { getProfileDir, resolveEnv } from './shared/index.js';
import { ensureCredentials, persistCredentialsToProfile, registerBoundCredentialRoutes } from './setup/index.js';
import { normalizeBots } from './bots/config.js';
import { BotRegistry } from './bots/registry.js';
import { registerBotsPickerRoute, registerBotsRoutes } from './bots/routes.js';
import { registerBotsBindRoutes } from './bots/bind.js';
import { registerWeixinBindRoutes } from './weixin/bind.js';
import { startWeixinChannel } from './weixin/channel.js';
import { AutomationEngine } from './automation/engine.js';
import { registerAutomationRoutes } from './automation/routes.js';
import { registerAutomationTool } from './automation/tool.js';
import { setInboundListener } from './transport/inbound.js';
import { ModelResolver } from './model/index.js';
import { registerSendFileTool } from './media/send-file-tool.js';
import { mountArchive2 } from './archive2/index.js';
import { ensureVisionInputModal, registerDescribeImageTool } from './media/vision-tool.js';
import { startMediaCleanup } from './media/media-cleaner.js';
// ── Cordis 插件元数据 ──
export const name = 'im-qqbot';
export const inject = ['agents'];
export const Config = ConfigSchema;
// ── 插件主体 ──
export async function apply(ctx, config) {
    const trace = (line) => {
        try {
            // 启动追踪：Host 日志在 Desktop 里不可见，排障靠这个文件
            appendFileSync('/tmp/qqbot-multi-boot.log', `${new Date().toISOString()} ${line}\n`);
        }
        catch { }
    };
    trace(`apply start bots=${JSON.stringify(config?.bots?.length ?? 0)} appId=${config?.appId ? 'yes' : 'no'}`);
    const agents = ctx.agents;
    const logger = ctx.logger ?? console;
    // 单机器人模式允许用环境变量提供凭据（原行为）；bots[] 逐项自带凭据
    const effective = {
        ...config,
        appId: resolveEnv(config.appId, 'QQBOT_APPID'),
        appSecret: resolveEnv(config.appSecret, 'QQBOT_SECRET'),
    };
    const { bots, warnings } = normalizeBots(effective);
    for (const warning of warnings)
        logger.warn(`im-qqbot: ${warning}`);
    const registry = new BotRegistry(logger);
    const modelResolver = new ModelResolver(ctx, config, logger);
    // 面板接口：机器人列表 / 模型清单 / 增删改（多机器人主入口）
    trace('routes+registry ready');
    registerBotsRoutes(ctx, registry, { config: effective, logger, modelResolver });
    registerBotsBindRoutes(ctx, { config: effective, logger });
    registerBotsPickerRoute(ctx, { logger });
    registerWeixinBindRoutes(ctx, { config: effective, logger });
    // 自动化：时间触发（cron）+ 事件触发（入站消息），动作=用某个机器人跑 prompt 再发出
    const engine = new AutomationEngine({ ctx, registry, logger }).start();
    ctx.effect(() => () => engine.stop(), 'qqbot-multi.automation');
    registerAutomationRoutes(ctx, { engine, registry });
    setInboundListener(event => engine.onMessage(event));
    registerAutomationTool(ctx, engine, registry, config, logger);
    // ── 没有任何可用凭据：唤起扫码绑定（单机器人流程，原行为） ──
    if (bots.length === 0) {
        logger.info('凭据未配置，启动扫码绑定...');
        void ensureCredentials(ctx, { logger, config: { ...config } })
            .then((credentials) => {
            if (!credentials) {
                logger.info('扫码绑定流程结束（未获取凭据或已手动配置）');
                return;
            }
            const persisted = persistCredentialsToProfile(credentials, getProfileDir() ?? undefined, logger);
            if (persisted) {
                logger.info('配置已保存，等待热更新重新加载...');
                return;
            }
            logger.warn('凭据未能持久化，本次进程将使用环境变量凭据启动（重启后需重新绑定）');
            void bootstrapGateway(ctx, agents, {
                ...config,
                id: 'default',
                name: 'QQ 机器人',
                appId: credentials.appId,
                appSecret: credentials.appSecret,
            }, logger, registry).catch((err) => {
                logger.error(`网关启动失败: ${err instanceof Error ? err.message : String(err)}`);
            });
        })
            .catch((err) => {
            logger.error(`扫码绑定流程异常: ${err instanceof Error ? err.message : String(err)}`);
        });
        return;
    }
    // ── 全局能力只注册一次：多机器人下由 bot 参数 / 会话归属路由 ──
    ensureVisionInputModal(config.vision, logger);
    registerDescribeImageTool(ctx, config.vision, logger);
    registerSendFileTool(ctx, registry, config, logger);
    mountArchive2(ctx, logger);
    if (config.media.enabled)
        startMediaCleanup(ctx, config.media.ttlHours, logger);
    // ── 单机器人模式保留原有的绑定/配置页路由（路径固定，多机器人时改走 /qqbot/bots） ──
    if (!bots.some(bot => bot.listed)) {
        registerBoundCredentialRoutes(ctx, logger, bots[0].appId, { ...config });
    }
    // ── 逐个连接（一个失败不影响其他机器人） ──
    for (const bot of bots) {
        if (bot.platform === 'weixin') {
            try {
                await startWeixinChannel(ctx, bot, logger, registry, engine);
                logger.info(`im-qqbot: 微信机器人 ${bot.id}（${bot.name}）已挂载`);
                trace(`weixin mounted ${bot.id}`);
            }
            catch (err) {
                logger.error(`im-qqbot: 微信机器人 ${bot.id} 启动失败: ${err instanceof Error ? err.message : String(err)}`);
                trace(`weixin FAILED ${bot.id}: ${err instanceof Error ? err.stack : String(err)}`);
            }
            continue;
        }
        try {
            await bootstrapGateway(ctx, agents, bot, logger, registry);
            logger.info(`im-qqbot: 机器人 ${bot.id}（${bot.name}）已挂载`);
            trace(`bot mounted ${bot.id}`);
        }
        catch (err) {
            logger.error(`im-qqbot: 机器人 ${bot.id}（${bot.name}）启动失败: ${err instanceof Error ? err.message : String(err)}`);
            trace(`bot FAILED ${bot.id}: ${err instanceof Error ? err.stack : String(err)}`);
        }
    }
}

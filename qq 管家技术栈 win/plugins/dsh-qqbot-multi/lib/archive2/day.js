/**
 * /day 的数据聚合：把某天某个群的消息压成一份摘要素材。
 *
 * 数据源：~/.dsh-qqbot/archive/<日期>.jsonl（原始归档，未被整理也不影响）
 * 输出：计数、参与者、分项、单位、金额、要点列表 —— 都是原文里能抽到的，抽不到就空。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN_HOME } from '../shared/dirs.js';
import { extractEvents } from './wiki.js';

const ARCHIVE_DIR = join(PLUGIN_HOME, 'archive');

export function cleanText(input) {
    return String(input ?? '')
        .replace(/<faceType=[^>]*>/g, '[表情]')
        .replace(/<@!?[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function todayKey(offsetDays = 0) {
    const date = new Date();
    date.setDate(date.getDate() + offsetDays);
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 解析日期参数：今天 / 昨天 / YYYY-MM-DD */
export function parseDayArg(input) {
    const raw = String(input ?? '').trim();
    if (raw === '' || raw === '今天' || raw === '今日') return todayKey(0);
    if (raw === '昨天' || raw === '昨日') return todayKey(-1);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    if (/^\d{1,2}-\d{1,2}$/.test(raw)) {
        const [month, day] = raw.split('-');
        const now = new Date();
        return `${now.getFullYear()}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    return null;
}

/** 汇总某天某群的消息 */
export function buildDayDigest(botId, groupOpenid, date, options = {}) {
    const skipSenders = new Set((options.skipSenders ?? []).filter(Boolean));
    const file = join(ARCHIVE_DIR, `${date}.jsonl`);
    if (!existsSync(file)) {
        return { date, messages: 0, images: 0, senders: [], categories: [], units: [], prices: [], highlights: [], empty: true };
    }

    const senders = new Map();
    const categories = new Set();
    const units = new Map();
    const prices = [];
    const highlights = [];
    let messages = 0;
    let images = 0;

    for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        let entry;
        try {
            entry = JSON.parse(line);
        } catch {
            continue;
        }
        if (String(entry.botId ?? '') !== String(botId)) continue;
        if (String(entry.groupOpenid ?? '') !== String(groupOpenid)) continue;

        const who = entry.senderName || String(entry.senderId ?? '').slice(-6) || '未知';
        if (skipSenders.has(who)) continue;   // 跳过其他机器人的发言

        messages += 1;
        const mediaCount = (entry.media ?? []).length;
        images += mediaCount;
        senders.set(who, (senders.get(who) ?? 0) + 1);

        const text = cleanText(entry.text);
        const extracted = extractEvents(text);
        extracted.categories.forEach(item => categories.add(item));
        extracted.units.forEach(item => units.set(`${item.role}:${item.name}`, item));
        extracted.prices.forEach(item => prices.push({ ...item, text }));
        extracted.quantities.forEach(item => {
            // 只有数量没有单价的也算一条记录
            if (!extracted.prices.length) prices.push({ amount: null, unit: item.unit, quantity: item.amount, text });
        });

        const stamp = new Date(entry.time ?? Date.now()).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
        if (text !== '' || mediaCount > 0) {
            highlights.push({
                time: stamp,
                sender: who,
                text: text.slice(0, 120),
                images: mediaCount,
            });
        }
    }

    return {
        date,
        messages,
        images,
        senders: [...senders.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
        categories: [...categories],
        units: [...units.values()],
        prices,
        highlights,
        empty: messages === 0,
    };
}

/** 把摘要素材排成一段可发送的文字 */
export function formatDigest(digest, groupLabel) {
    const lines = [`📅 ${digest.date} · ${groupLabel}`, ''];

    if (digest.empty) {
        lines.push('这一天没有归档到消息。');
        return lines.join('\n');
    }

    lines.push(`消息 ${digest.messages} 条 · 图片 ${digest.images} 张 · 参与 ${digest.senders.length} 人`);
    lines.push('');

    const hasEngineering = digest.categories.length > 0 || digest.prices.length > 0 || digest.units.length > 0;
    if (hasEngineering) {
        lines.push('工程内容：');
        if (digest.categories.length > 0) lines.push(`· 分项：${digest.categories.join('、')}`);
        for (const unit of digest.units) lines.push(`· ${unit.role}：${unit.name}`);
        if (digest.prices.length > 0) {
            lines.push('· 费用：');
            for (const price of digest.prices.slice(0, 8)) {
                if (price.amount === null) {
                    lines.push(`  - ${price.quantity}${price.unit}（原文未提及单价）`);
                }
                else if (price.quantity !== undefined && price.amount != null) {
                    lines.push(`  - ${price.quantity}${price.unit} × ${price.amount} 元 = ${price.quantity * price.amount} 元`);
                }
                else {
                    lines.push(`  - ${price.amount} 元/${price.unit}`);
                }
            }
        }
        lines.push('');
    }

    lines.push(hasEngineering ? '今日要点：' : '今日聊天：');
    for (const item of digest.highlights.slice(-12)) {
        const suffix = item.images > 0 ? ` [图片${item.images}张]` : '';
        lines.push(`${item.time} ${item.sender}：${item.text}${suffix}`);
    }
    if (digest.highlights.length > 12) lines.push(`…还有 ${digest.highlights.length - 12} 条`);

    if (!hasEngineering) {
        lines.push('', '（今天没有工程相关内容，以上为聊天摘要）');
    }
    return lines.join('\n');
}

/** 读出某个机器人已归档的群列表（用于私聊指定目标） */
export function listArchivedGroups(botId) {
    const statePath = join(PLUGIN_HOME, 'archive2', 'state.json');
    if (!existsSync(statePath)) return [];
    try {
        const state = JSON.parse(readFileSync(statePath, 'utf8'));
        const bucket = state?.groups?.[botId] ?? {};
        return Object.entries(bucket).map(([openid, info]) => ({
            openid,
            label: info?.name || info?.folder || openid.slice(0, 8),
        }));
    } catch {
        return [];
    }
}

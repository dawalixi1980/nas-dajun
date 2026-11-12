/**
 * 桥接：把 QQ归档2 的群消息，同步成「施工 Wiki」式的结构化归档。
 *
 * 输入：<归档根>/<机器人>/<群文件夹>/<日期>.jsonl + 媒体/<日期>/
 * 输出：<归档根>/<机器人>工程信息/
 *         <群名或文件夹>/
 *           结构/
 *             index.md                   项目索引（月份）
 *             2026.11月/
 *               index.md                 月索引（日期）
 *               08/
 *                 index.md               当日概览
 *                 聊天记录.md            可读聊天记录
 *                 events.jsonl           结构化事件
 *                 图片/                  当天的图片
 *
 * 规则提取（不花 token）：天气、地点、单位、分项、单价、数量。
 */
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RULES = {
    weather: /(晴|多云|阴天?|小雨|中雨|大雨|暴雨|阵雨|雷阵雨|雪|雾|大风)/g,
    place: /(K\d+\+\d+|\d+号路|[一二三四五六七八九十]标段|[一二三四五六七八九十]工区)/g,
    unit: /(建设单位|施工单位|监理单位)\s*[：:]\s*([^\s，,。;；]+)/g,
    price: /(\d+(?:\.\d+)?)\s*元\s*\/\s*(方|m³|立方米|吨|平方|㎡|米|个|根|套)/g,
    quantity: /(\d+(?:\.\d+)?)\s*(方|m³|立方米|吨|平方|㎡|米|个|根|套)/g,
};

const CATEGORIES = [
    ['路基', /清表|土方|填筑|压实|路床|边坡|换填|软基|挖方/],
    ['路面', /底基层|基层|面层|沥青|水稳|碎石垫层|摊铺|碾压/],
    ['挡土墙', /挡墙|墙身|泄水孔|墙背回填/],
    ['桥涵', /桩基|承台|台身|梁板|盖梁|桥面|涵洞|墩柱/],
    ['排渠', /沟槽|管道|检查井|雨水管|污水管|箱涵|盖板/],
];

function matchAll(text, regex) {
    const found = new Set();
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) found.add(match[0]);
    return [...found];
}

/** 从一条消息里抽施工要素（抽不到就是空数组，绝不编造） */
export function extractEvents(text) {
    const content = String(text ?? '');
    const categories = CATEGORIES.filter(([, pattern]) => pattern.test(content)).map(([name]) => name);
    const prices = [];
    RULES.price.lastIndex = 0;
    let price;
    while ((price = RULES.price.exec(content)) !== null) {
        prices.push({ amount: Number(price[1]), unit: price[3] });
    }
    const quantities = [];
    RULES.quantity.lastIndex = 0;
    let quantity;
    while ((quantity = RULES.quantity.exec(content)) !== null) {
        quantities.push({ amount: Number(quantity[1]), unit: quantity[2] });
    }
    return {
        weather: matchAll(content, RULES.weather),
        places: matchAll(content, RULES.place),
        units: [...content.matchAll(RULES.unit)].map(item => ({ role: item[1], name: item[2] })),
        categories,
        prices,
        quantities,
    };
}


const PYTHON_CANDIDATES = [
    '/Users/dada/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3',
    'python3',
];

/** 调用 excel.py 生成两个 Excel（失败只记日志，不影响归档） */
function runExcel(groupDir, logger) {
    const script = join(fileURLToPath(new URL('.', import.meta.url)), 'excel.py');
    const attempt = (index) => {
        if (index >= PYTHON_CANDIDATES.length) {
            logger?.warn?.('wiki-bridge: 找不到可用的 python，Excel 未生成');
            return;
        }
        const child = spawn(PYTHON_CANDIDATES[index], [script, groupDir], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            const text = chunk.toString().trim();
            if (text) logger?.info?.(`wiki-bridge: ${text}`);
        });
        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        child.on('error', () => attempt(index + 1));
        child.on('close', (code) => {
            if (code !== 0) {
                logger?.warn?.(`wiki-bridge: Excel 生成失败(${code}): ${stderr.slice(0, 200)}`);
            }
        });
    };
    attempt(0);
}

function pad(value) {
    return String(value).padStart(2, '0');
}

function dayParts(iso) {
    const date = new Date(iso);
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    return { year, month, day, time, monthDir: `${year}.${month}月` };
}

function sanitize(name) {
    return String(name ?? '').replace(/[\\/:*?"<>|]/g, '_').trim() || '未命名';
}

/** 生成单个群的结构化归档 */
async function buildGroup(botDir, outDir, groupInfo, logger) {
    const sourceDir = join(botDir, sanitize(groupInfo.folder));
    if (!existsSync(sourceDir)) return { label: '', total: 0 };

    const files = readdirSync(sourceDir).filter(name => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).sort();
    if (files.length === 0) return { label: '', total: 0 };

    const groupLabel = sanitize(groupInfo.name || groupInfo.folder);
    const structureDir = join(outDir, groupLabel, '结构');
    const byMonth = new Map();
    const collected = [];
    let total = 0;

    for (const file of files) {
        const day = file.replace('.jsonl', '');
        const records = [];
        for (const line of readFileSync(join(sourceDir, file), 'utf8').split('\n')) {
            if (!line.trim()) continue;
            try {
                records.push(JSON.parse(line));
            } catch { /* 忽略坏行 */ }
        }
        if (records.length === 0) continue;

        const first = dayParts(records[0].time ?? `${day}T00:00:00`);
        const dayDir = join(structureDir, first.monthDir, `${first.day}日`);
        await mkdir(join(dayDir, '图片'), { recursive: true });

        const chatLines = [];
        const eventLines = [];
        let imageCount = 0;

        for (const record of records) {
            const parts = dayParts(record.time ?? `${day}T00:00:00`);
            const who = record.senderName || String(record.senderId ?? '').slice(-6) || '未知';
            const text = String(record.text ?? '').replace(/\s+/g, ' ').trim();
            const mediaFiles = [];

            for (const item of record.media ?? []) {
                const relative = String(item?.file ?? '');
                if (relative === '') continue;
                const sourcePath = join(sourceDir, relative);
                if (!existsSync(sourcePath)) continue;
                const target = join(dayDir, '图片', basename(relative));
                try {
                    await copyFile(sourcePath, target);
                    mediaFiles.push(join('图片', basename(relative)));
                    imageCount += 1;
                } catch (err) {
                    logger?.warn?.(`wiki-bridge: 复制图片失败 ${sourcePath}: ${err instanceof Error ? err.message : String(err)}`);
                }
            }

            chatLines.push(`[${parts.time}] ${who}: ${text}${mediaFiles.length > 0 ? `  [图片 ${mediaFiles.length} 张]` : ''}`);
            const extracted = extractEvents(text);
            if (text !== '' || mediaFiles.length > 0) {
                collected.push({
                    time: record.time,
                    sender: who,
                    text,
                    images: mediaFiles,
                    categories: extracted.categories,
                    weather: extracted.weather,
                    places: extracted.places,
                    units: extracted.units,
                    prices: extracted.prices,
                    quantities: extracted.quantities,
                });
                eventLines.push(JSON.stringify({
                    time: record.time,
                    sender: who,
                    text,
                    images: mediaFiles,
                    categories: extracted.categories,
                    weather: extracted.weather,
                    places: extracted.places,
                    units: extracted.units,
                    prices: extracted.prices,
                    quantities: extracted.quantities,
                }));
            }
            total += 1;
        }

        // 聊天记录.md
        await writeFile(
            join(dayDir, '聊天记录.md'),
            `# ${day} 群聊记录\n\n${chatLines.join('\n')}\n`,
            'utf8',
        );

        // events.jsonl
        await writeFile(join(dayDir, 'events.jsonl'), `${eventLines.join('\n')}\n`, 'utf8');

        // 当日 index.md
        const categories = new Set();
        const weather = new Set();
        const places = new Set();
        for (const line of eventLines) {
            const parsed = JSON.parse(line);
            parsed.categories.forEach(item => categories.add(item));
            parsed.weather.forEach(item => weather.add(item));
            parsed.places.forEach(item => places.add(item));
        }
        await writeFile(
            join(dayDir, 'index.md'),
            [
                `# ${day} 施工日志概览`,
                '',
                `- 消息：${records.length} 条`,
                `- 图片：${imageCount} 张`,
                `- 分项：${[...categories].join('、') || '（原文未提及）'}`,
                `- 天气：${[...weather].join('、') || '（原文未提及）'}`,
                `- 地点：${[...places].join('、') || '（原文未提及）'}`,
                '',
                `详细内容见 [聊天记录.md](聊天记录.md)`,
                '',
            ].join('\n'),
            'utf8',
        );

        if (!byMonth.has(first.monthDir)) byMonth.set(first.monthDir, []);
        byMonth.get(first.monthDir).push({ day: first.day, count: records.length });
    }

    // 清理旧格式（纯数字）日目录，避免新旧并存
    for (const monthDir of byMonth.keys()) {
        const monthPath = join(structureDir, monthDir);
        if (!existsSync(monthPath)) continue;
        for (const entry of readdirSync(monthPath, { withFileTypes: true })) {
            if (!entry.isDirectory() || !/^\d{1,2}$/.test(entry.name)) continue;
            try {
                rmSync(join(monthPath, entry.name), { recursive: true, force: true });
            } catch { /* 忽略 */ }
        }
    }

    // 月索引
    for (const [monthDir, days] of byMonth) {
        days.sort((a, b) => a.day.localeCompare(b.day));
        await writeFile(
            join(structureDir, monthDir, 'index.md'),
            [
                `# ${monthDir} 目录`,
                '',
                ...days.map(item => `- [${item.day}日](${item.day}日/index.md) — ${item.count} 条`),
                '',
            ].join('\n'),
            'utf8',
        );
    }

    // 项目索引
    await writeFile(
        join(structureDir, 'index.md'),
        [
            `# ${groupLabel}`,
            '',
            `- 群 openid：${groupInfo.openid}`,
            `- 消息总数：${total}`,
            `- 最近更新：${new Date().toLocaleString('zh-CN')}`,
            '',
            '## 月份',
            '',
            ...[...byMonth.keys()].sort().map(month => `- [${month}](./${month}/index.md)`),
            '',
        ].join('\n'),
        'utf8',
    );

    // 供 Excel 生成器读取
    const outGroupDir = join(outDir, groupLabel);
    await mkdir(join(outGroupDir, '输出'), { recursive: true });
    await writeFile(
        join(outGroupDir, '输出', '施工数据.json'),
        `${JSON.stringify({ project: groupLabel, records: collected }, null, 2)}\n`,
        'utf8',
    );

    runExcel(outGroupDir, logger);
    return { label: groupLabel, total };
}

/** 为一个机器人生成全部群的结构化归档 */
export async function buildWiki(root, botName, groups, logger) {
    const botDir = join(root, sanitize(botName));
    const outDir = join(root, `${sanitize(botName)}工程信息`);
    if (!existsSync(botDir)) return { groups: 0, messages: 0, outDir };

    let groupCount = 0;
    let messageCount = 0;
    const currentLabels = new Set();

    for (const groupInfo of groups) {
        try {
            const built = await buildGroup(botDir, outDir, groupInfo, logger);
            if (built.label) currentLabels.add(built.label);
            if (built.total > 0) {
                groupCount += 1;
                messageCount += built.total;
            }
        }
        catch (err) {
            // 生成失败时也要保住它的目录，别被下面的清理逻辑误删
            currentLabels.add(sanitize(groupInfo.name || groupInfo.folder));
            logger?.warn?.(`wiki-bridge: 生成 ${groupInfo.folder} 失败: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    // 清理过期目录：改名后残留的旧文件夹（含 结构/ 的才算我们生成的）
    let removed = 0;
    if (existsSync(outDir)) {
        for (const entry of readdirSync(outDir, { withFileTypes: true })) {
            if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
            if (currentLabels.has(entry.name)) continue;
            const candidate = join(outDir, entry.name);
            if (!existsSync(join(candidate, '结构'))) continue;
            try {
                rmSync(candidate, { recursive: true, force: true });
                removed += 1;
                logger?.info?.(`wiki-bridge: 已清理过期目录 ${entry.name}`);
            } catch (err) {
                logger?.warn?.(`wiki-bridge: 清理 ${entry.name} 失败: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }

    return { groups: groupCount, messages: messageCount, outDir, removed };
}

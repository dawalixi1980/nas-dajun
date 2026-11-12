#!/usr/bin/env node
/**
 * 群聊归档 → 项目信息（结构层 + 占位输出）
 *
 * 数据源：任意名为「群聊归档」的目录（自动发现，支持迁移）
 *   <某目录>/群聊归档/<群名>_<日期>/
 *       消息/2026-11-08.jsonl
 *       图片/2026-11-08/*.jpg
 *
 * 输出：与「群聊归档」同级的「项目信息」
 *   <同一目录>/项目信息/<群名>/
 *       raw/       原始副本（只追加）
 *       结构/      按 年.月/日 递进
 *       输出/      Excel（由 build-excel.py 生成）
 *
 * 用法：
 *   node build-structure.mjs                 # 自动发现（默认扫描 ~/项目文件 等）
 *   node build-structure.mjs --scan <目录>    # 在指定目录下找「群聊归档」
 *   node build-structure.mjs --src <群聊归档> # 直接指定某个「群聊归档」
 */
import { copyFile, link, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, basename, dirname } from 'node:path';

const HOME = homedir();
const ARCHIVE_NAME = '群聊归档';
const OUTPUT_NAME = '项目信息';
const MAX_DEPTH = 4;

const pad = (n) => String(n).padStart(2, '0');

function dateParts(unixSeconds) {
  const d = new Date(unixSeconds * 1000);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return {
    key: `${y}-${pad(m)}-${pad(day)}`,
    monthDir: `${y}.${m}月`,
    dayDir: pad(day),
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    stamp: `${y}-${pad(m)}-${pad(day)} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

/** 把「群名_2026-11-07」还原成「群名」 */
function projectNameOf(folder) {
  return folder.replace(/_\d{4}-\d{2}-\d{2}$/, '');
}

/* ---------------- 发现「群聊归档」目录 ---------------- */

async function findArchives(root, depth = 0) {
  const found = [];
  if (depth > MAX_DEPTH) return found;
  let entries = [];
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return found; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === ARCHIVE_NAME) { found.push(join(root, e.name)); continue; }
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === OUTPUT_NAME) continue;
    found.push(...await findArchives(join(root, e.name), depth + 1));
  }
  return found;
}

/** 默认扫描位置：常见项目目录 */
function defaultScanRoots() {
  return [
    join(HOME, '项目文件'),
    join(HOME, 'Documents'),
    join(HOME, 'Desktop'),
  ];
}

/* ---------------- 渲染 ---------------- */

function renderChatRecord(projectName, dateKey, messages, imageMap) {
  const senders = new Set();
  let imageCount = 0;
  for (const m of messages) {
    senders.add(m.nickname);
    imageCount += (imageMap.get(String(m.messageId)) ?? []).length;
  }
  const lines = [
    `# ${projectName} · ${dateKey}`, '',
    `- 消息 ${messages.length} 条`,
    `- 图片 ${imageCount} 张`,
    `- 参与人 ${senders.size} 人`,
    `- 时间范围 ${dateParts(messages[0].time).time} – ${dateParts(messages.at(-1).time).time}`,
    '', '---', '',
  ];
  for (const m of messages) {
    const { time } = dateParts(m.time);
    lines.push(`**${time}  ${m.nickname}**  `);
    const text = String(m.text ?? '').trim();
    if (text) lines.push(text);
    for (const img of imageMap.get(String(m.messageId)) ?? []) lines.push(`![图片](图片/${img})`);
    lines.push('');
  }
  return lines.join('\n');
}

function renderProjectIndex(projectName, months) {
  const total = months.reduce((s, x) => s + x.days.reduce((a, d) => a + d.count, 0), 0);
  const lines = [
    `# ${projectName}`, '',
    `- 归档 ${months.length} 个月 / ${months.reduce((s, x) => s + x.days.length, 0)} 天`,
    `- 消息 ${total} 条`, '', '## 月份', '',
  ];
  for (const m of months) {
    const n = m.days.reduce((a, d) => a + d.count, 0);
    lines.push(`- [${m.name}/](${encodeURIComponent(m.name)}/index.md) — ${m.days.length} 天 / ${n} 条`);
  }
  return lines.join('\n') + '\n';
}

function renderMonthIndex(projectName, monthName, days) {
  const lines = [
    `# ${projectName} · ${monthName}`, '',
    `- ${days.length} 天 / ${days.reduce((a, d) => a + d.count, 0)} 条消息`, '',
    '## 日期', '',
  ];
  for (const d of days) {
    lines.push(`- [${d.day} 日](${encodeURIComponent(d.day)}/index.md) — ${d.count} 条 / ${d.images} 张图`);
  }
  return lines.join('\n') + '\n';
}

function renderDayIndex(projectName, dateKey, messages, imageMap) {
  const senders = [...new Set(messages.map((m) => m.nickname))];
  const imgCount = messages.reduce((a, m) => a + (imageMap.get(String(m.messageId)) ?? []).length, 0);
  const lines = [
    `# ${projectName} · ${dateKey}`, '',
    `- 消息 ${messages.length} 条`,
    `- 图片 ${imgCount} 张`,
    `- 参与人：${senders.join('、')}`, '',
    '## 文件', '',
    '- [聊天记录.md](聊天记录.md) — 当天全部消息',
    '- [events.jsonl](events.jsonl) — 结构化事件',
    imgCount ? '- [图片/](图片/) — 当天图片' : '',
    '', '## 时间线', '',
  ];
  for (const m of messages.slice(0, 20)) {
    const { time } = dateParts(m.time);
    const t = String(m.text ?? '').replace(/\n/g, ' ').slice(0, 60);
    lines.push(`- ${time} **${m.nickname}**：${t}`);
  }
  if (messages.length > 20) lines.push(`- …（共 ${messages.length} 条，见聊天记录.md）`);
  return lines.filter((x) => x !== '').join('\n') + '\n';
}


/** folder → peerId（来自整理器状态） */
async function loadPeerMap(archiveDir) {
  const state = await readJson(join(archiveDir, '.organizer', 'state.json'), {});
  const map = new Map();
  for (const [peerId, peer] of Object.entries(state.peers ?? {})) {
    if (peer?.folder) map.set(peer.folder, String(peerId));
  }
  return map;
}

/**
 * 兜底：整理器对「曾被隐藏的群」会跳过写入但照样推进游标，导致归档里缺消息。
 * 这里从 dsh-qq-access 的原始数据按 peerId 补齐，避免数据缺口。
 */
async function fallbackMessages(peerId) {
  const dir = join(HOME, '.dsh-qq-access', 'data', 'messages');
  let names = [];
  try { names = (await readdir(dir)).filter((n) => n.endsWith('.jsonl')); } catch { return []; }
  const out = [];
  for (const name of names) {
    let text = '';
    try { text = await readFile(join(dir, name), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.includes(peerId)) continue;
      try {
        const m = JSON.parse(line);
        if (String(m.peerId) === peerId) out.push(m);
      } catch { /* 跳过 */ }
    }
  }
  return out;
}

/* ---------------- 单个「群聊归档」的处理 ---------------- */

async function processArchive(archiveDir) {
  const parent = dirname(archiveDir);
  const outRoot = join(parent, OUTPUT_NAME);

  let folders = [];
  try {
    const entries = await readdir(archiveDir, { withFileTypes: true });
    folders = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
  } catch { return { archiveDir, projects: [], skipped: true }; }

  const projects = [];

  for (const folder of folders) {
    const projectName = projectNameOf(folder);
    const msgDir = join(archiveDir, folder, '消息');
    let files = [];
    // 注意：没有 消息/ 目录时不直接跳过，留给下面的「原始数据兜底」
    try { files = (await readdir(msgDir)).filter((n) => n.endsWith('.jsonl')).sort(); }
    catch { files = []; }

    /** dateKey → Map(messageId → message) */
    const days = new Map();
    let dupes = 0;
    for (const name of files) {
      const text = await readFile(join(msgDir, name), 'utf8');
      for (const line of text.split('\n')) {
        if (!line) continue;
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        if (m?.kind && m.kind !== 'group') continue;
        const { key } = dateParts(m.time);
        if (!days.has(key)) days.set(key, new Map());
        const bucket = days.get(key);
        const id = String(m.messageId);
        if (bucket.has(id)) dupes += 1;
        bucket.set(id, m);
      }
    }
    // 归档里没有消息时，从原始数据兜底（整理器可能因隐藏而漏写）
    if (!days.size) {
      const peerMap = await loadPeerMap(archiveDir);
      const peerId = peerMap.get(folder);
      if (!peerId) continue;
      for (const m of await fallbackMessages(peerId)) {
        const { key } = dateParts(m.time);
        if (!days.has(key)) days.set(key, new Map());
        days.get(key).set(String(m.messageId), m);
      }
      if (!days.size) continue;
      console.log(`  （${projectName} 归档缺消息，已从原始数据兜底）`);
    }

    const projectDir = join(outRoot, projectName);
    const rawProject = join(projectDir, 'raw');
    await mkdir(join(rawProject, '消息'), { recursive: true });
    await mkdir(join(rawProject, '图片'), { recursive: true });

    const months = new Map();
    let dayCount = 0, msgCount = 0, imgCount = 0;

    for (const [dateKey, bucket] of [...days].sort()) {
      const messages = [...bucket.values()].sort((a, b) => a.time - b.time);
      const { monthDir, dayDir } = dateParts(messages[0].time);

      // 图片索引：从归档目录的 图片/<日期>/ 里按 messageId 前缀匹配
      const srcImgDir = join(archiveDir, folder, '图片', dateKey);
      const imageMap = new Map();
      let imgNames = [];
      try { imgNames = await readdir(srcImgDir); } catch { /* 无图 */ }
      for (const n of imgNames) {
        const m = /^(\d+)-/.exec(n);
        if (!m) continue;
        if (!imageMap.has(m[1])) imageMap.set(m[1], []);
        imageMap.get(m[1]).push(n);
      }

      // raw 副本
      const rawMsg = join(rawProject, '消息', `${dateKey}.jsonl`);
      if (!(await exists(rawMsg))) {
        await writeFile(rawMsg, messages.map((m) => JSON.stringify(m)).join('\n') + '\n');
      }
      const rawImgDir = join(rawProject, '图片', dateKey);
      await mkdir(rawImgDir, { recursive: true });

      // 结构层
      const dayDirPath = join(projectDir, '结构', monthDir, dayDir);
      await mkdir(join(dayDirPath, '图片'), { recursive: true });
      await writeFile(join(dayDirPath, '聊天记录.md'), renderChatRecord(projectName, dateKey, messages, imageMap));
      await writeFile(join(dayDirPath, 'index.md'), renderDayIndex(projectName, dateKey, messages, imageMap));

      const events = messages.map((m) => JSON.stringify({
        event_id: `${m.peerId}-${m.messageId}`,
        date: dateKey,
        raw: { time: m.time, sender: m.nickname, sender_id: m.senderId, text: m.text, message_id: m.messageId },
        category: null, location: null, process: null, description: null,
        parties: [], quantity: null, unit_price: null, amount: null, status: null,
      }));
      await writeFile(join(dayDirPath, 'events.jsonl'), events.join('\n') + '\n');

      // 图片硬链接（失败则复制）
      for (const list of imageMap.values()) {
        for (const img of list) {
          const src = join(srcImgDir, img);
          for (const dstDir of [rawImgDir, join(dayDirPath, '图片')]) {
            const dst = join(dstDir, img);
            if (await exists(dst)) continue;
            try { await link(src, dst); }
            catch { try { await copyFile(src, dst); } catch { /* 忽略 */ } }
          }
        }
      }

      dayCount += 1;
      msgCount += messages.length;
      imgCount += [...imageMap.values()].reduce((a, x) => a + x.length, 0);
      if (!months.has(monthDir)) months.set(monthDir, []);
      months.get(monthDir).push({ day: dayDir, count: messages.length, images: imageMap.size });
    }

    const monthList = [...months].sort().map(([name, ds]) => ({ name, days: ds }));
    await writeFile(join(projectDir, '结构', 'index.md'), renderProjectIndex(projectName, monthList));
    for (const m of monthList) {
      await writeFile(join(projectDir, '结构', m.name, 'index.md'), renderMonthIndex(projectName, m.name, m.days));
    }
    await mkdir(join(projectDir, '输出'), { recursive: true });

    projects.push({ name: projectName, days: dayCount, messages: msgCount, images: imgCount, dupes });
  }

  return { archiveDir, outRoot, projects };
}

/* ---------------- 主流程 ---------------- */

async function main() {
  const argv = process.argv.slice(2);
  let archives = [];

  const scanIdx = argv.indexOf('--scan');
  const srcIdx = argv.indexOf('--src');
  if (srcIdx >= 0 && argv[srcIdx + 1]) {
    archives = [argv[srcIdx + 1]];
  } else if (scanIdx >= 0 && argv[scanIdx + 1]) {
    archives = await findArchives(argv[scanIdx + 1]);
  } else {
    for (const root of defaultScanRoots()) {
      if (!(await exists(root))) continue;
      archives.push(...await findArchives(root));
    }
    archives = [...new Set(archives)];
  }

  if (!archives.length) {
    console.log(`没有找到名为「${ARCHIVE_NAME}」的目录。`);
    console.log('可用 --scan <目录> 指定搜索位置，或 --src <群聊归档路径> 直接指定。');
    return;
  }

  let totalDays = 0, totalMsgs = 0, totalImgs = 0, totalDupes = 0, totalProjects = 0;

  for (const archiveDir of archives) {
    if (!(await exists(archiveDir))) { console.log(`跳过（不存在）：${archiveDir}`); continue; }
    console.log(`源：${archiveDir}`);
    const res = await processArchive(archiveDir);
    if (!res.projects.length) { console.log('  （没有可处理的群）'); continue; }
    console.log(`目标：${res.outRoot}`);
    for (const p of res.projects) {
      console.log(`  ${p.name}: ${p.days} 天 / ${p.messages} 条 / ${p.images} 图`);
      totalDays += p.days; totalMsgs += p.messages; totalImgs += p.images; totalDupes += p.dupes;
    }
    totalProjects += res.projects.length;
    console.log('');
  }

  if (totalDupes) console.log(`已按 messageId 去重 ${totalDupes} 条重复记录`);
  console.log(`完成：${archives.length} 个归档目录 / ${totalProjects} 个项目 / ${totalDays} 天 / ${totalMsgs} 条消息 / ${totalImgs} 张图片`);
}

main().catch((e) => { console.error('失败：', e.message); process.exit(1); });

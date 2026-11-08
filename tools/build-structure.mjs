#!/usr/bin/env node
/**
 * 群聊归档 → 项目结构（P0：不调模型）
 *
 * 输入：~/.dsh-qq-access/data/messages/*.jsonl（dsh-qq-access 的原始归档）
 *       ~/项目文件/群聊归档/<群名_日期>/图片/<日期>/（整理器已硬链接好的图片）
 * 输出：<目标根>/<项目>/{raw,结构,输出}/  —— 每个项目自成一套
 *
 * 设计要点：
 *   - 群名 = 项目名
 *   - 结构层按「年.月 / 日」递进，每天一个文件夹
 *   - 每天包含：聊天记录.md、图片/、events.jsonl（占位，P1 再抽取）
 *   - raw 层是原始 JSONL 的副本，不可变；结构层是加工产物
 */
import { copyFile, link, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';

const HOME = homedir();
const MSG_DIR = join(HOME, '.dsh-qq-access/data/messages');
const ORGANIZER_ROOT = join(HOME, '项目文件/群聊归档');
const ORGANIZER_STATE = join(ORGANIZER_ROOT, '.organizer/state.json');

const TARGET = process.argv[2] || join(HOME, '项目文件/项目信息');

const pad = (n) => String(n).padStart(2, '0');

/** 本地时区的日期拆分 */
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

/** 群号 → { 群名, 文件夹 } */
async function loadProjects() {
  const state = await readJson(ORGANIZER_STATE, { peers: {} });
  const map = new Map();
  for (const [peerId, peer] of Object.entries(state.peers ?? {})) {
    if (peer.kind !== 'group') continue;
    map.set(String(peerId), {
      name: peer.name || `群_${peerId}`,
      folder: peer.folder,
    });
  }
  return map;
}

/** 某群某天的图片：messageId → [文件名] */
async function indexImages(folder, dateKey) {
  const dir = join(ORGANIZER_ROOT, folder, '图片', dateKey);
  const map = new Map();
  let names = [];
  try { names = await readdir(dir); } catch { return map; }
  for (const n of names) {
    const m = /^(\d+)-/.exec(n);
    if (!m) continue;
    if (!map.has(m[1])) map.set(m[1], []);
    map.get(m[1]).push(n);
  }
  return map;
}

function renderChatRecord(projectName, dateKey, messages, imageMap) {
  const senders = new Map();
  let imageCount = 0;
  for (const m of messages) {
    senders.set(m.nickname, (senders.get(m.nickname) ?? 0) + 1);
    imageCount += (imageMap.get(String(m.messageId)) ?? []).length;
  }
  const lines = [
    `# ${projectName} · ${dateKey}`,
    '',
    `- 消息 ${messages.length} 条`,
    `- 图片 ${imageCount} 张`,
    `- 参与人 ${senders.size} 人`,
    `- 时间范围 ${dateParts(messages[0].time).time} – ${dateParts(messages.at(-1).time).time}`,
    '',
    '---',
    '',
  ];
  for (const m of messages) {
    const { time } = dateParts(m.time);
    lines.push(`**${time}  ${m.nickname}**  `);
    const text = String(m.text ?? '').trim();
    if (text) lines.push(text);
    const imgs = imageMap.get(String(m.messageId)) ?? [];
    for (const img of imgs) lines.push(`![图片](图片/${img})`);
    lines.push('');
  }
  return lines.join('\n');
}

function renderProjectIndex(projectName, months) {
  const total = months.reduce((s, x) => s + x.days.reduce((a, d) => a + d.count, 0), 0);
  const lines = [
    `# ${projectName}`,
    '',
    `- 归档天数 ${months.length} 月 / ${months.reduce((s, x) => s + x.days.length, 0)} 天`,
    `- 消息总数 ${total} 条`,
    '',
    '## 月份',
    '',
  ];
  for (const m of months) {
    const n = m.days.reduce((a, d) => a + d.count, 0);
    lines.push(`- [${m.name}/](${encodeURIComponent(m.name)}/index.md) — ${m.days.length} 天 / ${n} 条`);
  }
  return lines.join('\n') + '\n';
}

function renderMonthIndex(projectName, monthName, days) {
  const lines = [
    `# ${projectName} · ${monthName}`,
    '',
    `- ${days.length} 天 / ${days.reduce((a, d) => a + d.count, 0)} 条消息`,
    '',
    '## 日期',
    '',
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
    `# ${projectName} · ${dateKey}`,
    '',
    `- 消息 ${messages.length} 条`,
    `- 图片 ${imgCount} 张`,
    `- 参与人：${senders.join('、')}`,
    '',
    '## 文件',
    '',
    '- [聊天记录.md](聊天记录.md) — 当天全部消息',
    '- [events.jsonl](events.jsonl) — 结构化事件（占位，P1 抽取）',
    imgCount ? '- [图片/](图片/) — 当天图片' : '',
    '',
    '## 时间线',
    '',
  ];
  for (const m of messages.slice(0, 20)) {
    const { time } = dateParts(m.time);
    const t = String(m.text ?? '').replace(/\n/g, ' ').slice(0, 60);
    lines.push(`- ${time} **${m.nickname}**：${t}`);
  }
  if (messages.length > 20) lines.push(`- …（共 ${messages.length} 条，见聊天记录.md）`);
  return lines.filter((x) => x !== '').join('\n') + '\n';
}

async function main() {
  console.log(`目标根：${TARGET}`);

  const projects = await loadProjects();
  if (!projects.size) throw new Error('整理器状态里没有群，先跑一次 sync.sh');

  // 读全部原始 JSONL
  let files = [];
  try { files = (await readdir(MSG_DIR)).filter((n) => n.endsWith('.jsonl')).sort(); }
  catch { throw new Error(`读不到归档目录：${MSG_DIR}`); }

  /** peerId → dateKey → Map(messageId → message) */
  const byProject = new Map();
  let dupes = 0;
  for (const name of files) {
    const text = await readFile(join(MSG_DIR, name), 'utf8');
    for (const line of text.split('\n')) {
      if (!line) continue;
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      if (!m?.peerId || m.kind !== 'group') continue;
      const peerId = String(m.peerId);
      if (!projects.has(peerId)) continue;
      const { key } = dateParts(m.time);
      if (!byProject.has(peerId)) byProject.set(peerId, new Map());
      const days = byProject.get(peerId);
      if (!days.has(key)) days.set(key, new Map());
      const bucket = days.get(key);
      // 按 messageId 去重：换号后 poll 会把历史重捞一遍，
      // dsh-qq-access 的去重键含 selfId，所以同一条消息会存两份。
      const id = String(m.messageId);
      if (bucket.has(id)) dupes += 1;
      bucket.set(id, m);
    }
  }

  let written = { projects: 0, days: 0, messages: 0, images: 0, copied: 0 };

  for (const [peerId, days] of byProject) {
    const project = projects.get(peerId);
    const projectName = project.name;

    // raw 层
    const projectDir = join(TARGET, projectName);
    const rawProject = join(projectDir, 'raw');
    await mkdir(join(rawProject, '消息'), { recursive: true });
    await mkdir(join(rawProject, '图片'), { recursive: true });

    const months = new Map();
    for (const [dateKey, bucket] of [...days].sort()) {
      const messages = [...bucket.values()].sort((a, b) => a.time - b.time);
      const imageMap = await indexImages(project.folder, dateKey);
      const { monthDir, dayDir } = dateParts(messages[0].time);

      // raw：按天复制原始 JSONL + 图片硬链接/复制
      const rawMsg = join(rawProject, '消息', `${dateKey}.jsonl`);
      if (!(await exists(rawMsg))) {
        await writeFile(rawMsg, messages.map((m) => JSON.stringify(m)).join('\n') + '\n');
        written.copied += 1;
      }
      const rawImgDir = join(rawProject, '图片', dateKey);
      await mkdir(rawImgDir, { recursive: true });
      for (const list of imageMap.values()) for (const img of list) {
        const src = join(ORGANIZER_ROOT, project.folder, '图片', dateKey, img);
        const dst = join(rawImgDir, img);
        if (await exists(dst)) continue;
        try { await link(src, dst); }
        catch { try { await copyFile(src, dst); } catch { /* 忽略 */ } }
      }

      // 结构层
      const dayDirPath = join(projectDir, '结构', monthDir, dayDir);
      await mkdir(join(dayDirPath, '图片'), { recursive: true });
      await writeFile(join(dayDirPath, '聊天记录.md'), renderChatRecord(projectName, dateKey, messages, imageMap));
      await writeFile(join(dayDirPath, 'index.md'), renderDayIndex(projectName, dateKey, messages, imageMap));
      // events.jsonl 占位：每条消息一行，字段留待 P1 填充
      const events = messages.map((m) => JSON.stringify({
        event_id: `${peerId}-${m.messageId}`,
        date: dateKey,
        raw: { time: m.time, sender: m.nickname, sender_id: m.senderId, text: m.text, message_id: m.messageId },
        category: null, location: null, process: null, description: null,
        parties: [], quantity: null, unit_price: null, amount: null, status: null,
      }));
      await writeFile(join(dayDirPath, 'events.jsonl'), events.join('\n') + '\n');

      for (const list of imageMap.values()) for (const img of list) {
        const src = join(ORGANIZER_ROOT, project.folder, '图片', dateKey, img);
        const dst = join(dayDirPath, '图片', img);
        if (await exists(dst)) continue;
        try { await link(src, dst); }
        catch { try { await copyFile(src, dst); } catch { /* 忽略 */ } }
      }

      written.days += 1;
      written.messages += messages.length;
      written.images += [...imageMap.values()].reduce((a, x) => a + x.length, 0);

      if (!months.has(monthDir)) months.set(monthDir, []);
      months.get(monthDir).push({ day: dayDir, count: messages.length, images: imageMap.size });
    }

    // 索引
    const monthList = [...months].sort().map(([name, ds]) => ({ name, days: ds }));
    await writeFile(join(projectDir, '结构', 'index.md'), renderProjectIndex(projectName, monthList));
    for (const m of monthList) {
      await writeFile(join(projectDir, '结构', m.name, 'index.md'),
        renderMonthIndex(projectName, m.name, m.days));
    }

    // 输出层占位
    await mkdir(join(projectDir, '输出'), { recursive: true });
    written.projects += 1;
    console.log(`  项目「${projectName}」：${monthList.length} 个月 / ${[...days].length} 天`);
    console.log(`    raw/ → ${join(projectDir, 'raw')}`);
    console.log(`    结构/ → ${join(projectDir, '结构')}`);
    console.log(`    输出/ → ${join(projectDir, '输出')}`);
  }

  console.log('');
  if (dupes) console.log(`（已按 messageId 去重 ${dupes} 条重复记录）`);
  console.log(`完成：${written.projects} 个项目 / ${written.days} 天 / ${written.messages} 条消息 / ${written.images} 张图片`);
}

main().catch((e) => { console.error('失败：', e.message); process.exit(1); });

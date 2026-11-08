/**
 * dsh-construction-wiki
 *
 * 施工 Wiki 插件：把 QQ 群聊归档整理成「按天递进的结构层 + 施工日志 / 单价台账 Excel」，
 * 并支持从 GitHub 仓库拉取最新的技能定义与工具脚本。
 *
 * 数据流：
 *   <项目>/raw/        qq-access 原始归档（只追加）
 *     ↓ build-structure（规则，不花 token）
 *   <项目>/结构/<年.月>/<日>/  ← 聊天记录.md + 图片 + events.jsonl
 *     ↓ build-excel（规则抽取，不花 token）
 *   <项目>/输出/施工日志与单价台账.xlsx
 *
 * 每个项目自成一套，互不干扰。
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile, copyFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const HOME = homedir();
const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = join(PLUGIN_DIR, 'tools');
const SKILL_SRC = join(PLUGIN_DIR, 'skills');
const SKILL_DST = join(HOME, '.dsh', 'skills');
const CONFIG_PATH = join(HOME, '.dsh-construction-wiki', 'config.json');
const STATE_PATH = join(HOME, '.dsh-construction-wiki', 'state.json');
const DEFAULT_ROOT = join(HOME, '项目文件/项目信息');
const DEFAULT_REPO = 'dawalixi1980/nas-dajun';
const PREFIX = '/construction-wiki/api';
/** 技能在仓库中的目录：插件只监听这里的变更 */
const SKILL_PATH = 'dajunskill';
/** 具体技能名 */
const SKILL_SLUG = 'construction-wiki';

/** 运行插件脚本用的 node：优先用宿主自带的，退回系统 node */
const NODE_BIN = process.env.DSH_NODE_BIN
  || '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness';
const NODE_ENV_EXTRA = process.env.DSH_NODE_BIN ? {} : { ELECTRON_RUN_AS_NODE: '1' };

let PYTHON_BIN = process.env.DSH_PYTHON_BIN
  || join(HOME, '.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3');

export const name = 'construction-wiki';
export const inject = ['tools', 'webServer'];

/* ---------------- 基础工具 ---------------- */

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

async function writeJson(file, data) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
}

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function loadConfig() {
  const cfg = await readJson(CONFIG_PATH, {});
  return {
    root: cfg.root || DEFAULT_ROOT,
    repo: cfg.repo || DEFAULT_REPO,
    autoUpdate: cfg.autoUpdate !== false,
  };
}

async function saveConfig(patch) {
  const cur = await readJson(CONFIG_PATH, {});
  const next = { ...cur, ...patch };
  await writeJson(CONFIG_PATH, next);
  return next;
}

/** 跑 node 工具（build-structure.mjs） */
async function runNodeTool(script, args) {
  const env = { ...process.env, ...NODE_ENV_EXTRA };
  const { stdout, stderr } = await execFileAsync(
    NODE_BIN, [join(TOOLS_DIR, script), ...args],
    { env, timeout: 180_000, maxBuffer: 16 * 1024 * 1024 },
  );
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

/** 跑 python 工具（build-excel.py） */
async function runPythonTool(script, args) {
  let py = PYTHON_BIN;
  if (!(await exists(py))) {
    // 退而求其次：系统 python3（需自带 openpyxl）
    py = 'python3';
  }
  const { stdout, stderr } = await execFileAsync(
    py, [join(TOOLS_DIR, script), ...args],
    { timeout: 180_000, maxBuffer: 16 * 1024 * 1024 },
  );
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

/* ---------------- GitHub 更新 ---------------- */

async function githubLatest(repo, path = SKILL_PATH) {
  // 只关注 dajunskill/ 目录下的提交：其他目录（文档、脚本）改动不触发技能更新
  const q = path ? `&path=${encodeURIComponent(path)}` : "";
  const res = await fetch(`https://api.github.com/repos/${repo}/commits?per_page=1${q}`, {
    headers: { 'User-Agent': 'dsh-construction-wiki', Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(10_000),
  });
  // 409 = 仓库还没有任何提交（空仓库），这不是错误
  if (res.status === 409) return { empty: true };
  if (!res.ok) throw new Error(`GitHub ${res.status}：${repo}`);
  const arr = await res.json();
  if (!Array.isArray(arr) || !arr.length) return { empty: true };
  const c = arr[0];
  return {
    sha: c.sha,
    short: String(c.sha).slice(0, 7),
    date: c.commit?.author?.date ?? '',
    message: (c.commit?.message ?? '').split('\n')[0].slice(0, 120),
  };
}

async function checkUpdate() {
  const cfg = await loadConfig();
  const state = await readJson(STATE_PATH, {});
  let latest = null;
  let error = null;
  try { latest = await githubLatest(cfg.repo); }
  catch (e) { error = e.message; }
  return {
    repo: cfg.repo,
    localSha: state.sha ?? null,
    localVersion: state.version ?? '0.1.0',
    latest,
    empty: Boolean(latest && latest.empty),
    upToDate: Boolean(latest && !latest.empty && state.sha && latest.sha === state.sha),
    error,
  };
}


/**
 * 从仓库 dajunskill/ 目录拉取技能文件到 ~/.dsh/skills/。
 *
 * 为什么用 raw.githubusercontent 而不是 git pull：
 *   - 不需要用户在目标机器上装 git
 *   - Win / macOS 行为一致
 *   - 只取技能定义，不碰插件代码，更新风险最小
 */
async function pullSkillFromRepo(repo, ref) {
  const base = `https://raw.githubusercontent.com/${repo}/${ref}/${SKILL_PATH}/${SKILL_SLUG}`;
  const files = ['SKILL.md', 'references.md'];
  const dst = join(SKILL_DST, SKILL_SLUG);
  await mkdir(dst, { recursive: true });
  const written = [];
  for (const name of files) {
    const url = `${base}/${name}`;
    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    } catch { continue; }
    if (!res.ok) continue;                       // 可选文件不存在就跳过
    const text = await res.text();
    if (!text.trim()) continue;
    await writeFile(join(dst, name), text);
    written.push(name);
  }
  if (!written.length) throw new Error(`拉取失败：${base}/SKILL.md 取不到`);
  return { written, dst };
}


/* ---------------- 每日自动整理（定时任务） ---------------- */

const SCHEDULE_PATH = join(HOME, '.dsh-construction-wiki', 'schedule.json');
const DAILY_SH = join(TOOLS_DIR, 'daily.sh');
const LAUNCHD_LABEL = 'com.qq.construction-wiki';
const LAUNCHD_PLIST = join(HOME, 'Library', 'LaunchAgents', LAUNCHD_LABEL + '.plist');

async function loadSchedule() {
  const raw = await readJson(SCHEDULE_PATH, {});
  return {
    enabled: raw.enabled !== false,
    hour: Number.isInteger(raw.hour) ? raw.hour : 22,
    minute: Number.isInteger(raw.minute) ? raw.minute : 0,
    scanRoot: raw.scanRoot || join(HOME, '项目文件'),
  };
}

async function saveSchedule(patch) {
  const next = { ...(await loadSchedule()), ...patch };
  next.hour = Math.min(23, Math.max(0, Math.trunc(Number(next.hour)) || 0));
  next.minute = Math.min(59, Math.max(0, Math.trunc(Number(next.minute)) || 0));
  await writeJson(SCHEDULE_PATH, next);
  return next;
}

/** 写系统定时任务。macOS 用 launchd；其他平台返回提示。 */
async function writeLaunchd(sched) {
  if (process.platform !== 'darwin') {
    return { ok: false, error: '当前系统不是 macOS，请用计划任务调用 tools/daily.sh' };
  }
  await mkdir(dirname(LAUNCHD_PLIST), { recursive: true });
  const outLog = join(HOME, '.qq-organizer', 'construction-wiki.out');
  const plist = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    '  <key>Label</key><string>' + LAUNCHD_LABEL + '</string>',
    '  <key>ProgramArguments</key><array>',
    '    <string>/bin/sh</string>',
    '    <string>' + DAILY_SH + '</string>',
    '    <string>' + sched.scanRoot + '</string>',
    '  </array>',
    '  <key>StartCalendarInterval</key><dict>',
    '    <key>Hour</key><integer>' + sched.hour + '</integer>',
    '    <key>Minute</key><integer>' + sched.minute + '</integer>',
    '  </dict>',
    '  <key>StandardOutPath</key><string>' + outLog + '</string>',
    '  <key>StandardErrorPath</key><string>' + outLog + '</string>',
    '</dict></plist>',
    '',
  ].join(String.fromCharCode(10));
  await writeFile(LAUNCHD_PLIST, plist);

  const uid = process.getuid?.() ?? 501;
  await execFileAsync('launchctl', ['bootout', 'gui/' + uid + '/' + LAUNCHD_LABEL]).catch(() => {});
  if (sched.enabled) {
    await execFileAsync('launchctl', ['bootstrap', 'gui/' + uid, LAUNCHD_PLIST]).catch(async () => {
      await execFileAsync('launchctl', ['load', '-w', LAUNCHD_PLIST]).catch(() => {});
    });
  }
  return { ok: true, plist: LAUNCHD_PLIST, enabled: sched.enabled };
}

/* ---------------- 归档数据源 ---------------- */

async function listProjects() {
  const cfg = await loadConfig();
  const structure = join(cfg.root, '结构');
  let names = [];
  try {
    const entries = await readdir(structure, { withFileTypes: true });
    names = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch { /* 还没生成 */ }
  return { root: cfg.root, projects: names };
}

/* ---------------- 主逻辑 ---------------- */

export async function apply(ctx, config = {}) {
  if (config.root) await saveConfig({ root: String(config.root) });
  const cfg = await loadConfig();

  // 首次运行：把技能装到 ~/.dsh/skills
  try {
    await mkdir(SKILL_DST, { recursive: true });
    const src = join(SKILL_SRC, 'construction-wiki');
    if (await exists(src)) {
      const dst = join(SKILL_DST, 'construction-wiki');
      await mkdir(dst, { recursive: true });
      for (const f of await readdir(src)) {
        await copyFile(join(src, f), join(dst, f));
      }
      ctx.logger?.info?.(`施工 wiki 技能已安装到 ${dst}`);
    }
  } catch (error) {
    ctx.logger?.warn?.(`技能安装失败：${error?.message ?? error}`);
  }

  /* ---------- 路由 ---------- */

  const webServer = ctx.webServer;
  const disposers = [];

  const send = (res, code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };

  const readBody = async (req) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return Buffer.concat(chunks).toString('utf8');
  };

  const isLocal = (req) => {
    const a = req.socket?.remoteAddress ?? '';
    return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
  };

  if (webServer && typeof webServer.register === 'function') {
    const route = (path, handler) => {
      ctx.effect(() => webServer.register({
        kind: 'exact',
        path,
        handler: async (req, res) => {
          try {
            if (!isLocal(req)) return send(res, 403, { ok: false, error: '仅本机可访问' });
            await handler(req, res);
          } catch (error) {
            send(res, 500, { ok: false, error: String(error?.message ?? error) });
          }
        },
      }), `construction-wiki route ${path}`);
    };

    route(`${PREFIX}/state`, async (req, res) => {
      const cfgNow = await loadConfig();
      const { projects } = await listProjects();
      const update = await checkUpdate();
      send(res, 200, { ok: true, root: cfgNow.root, repo: cfgNow.repo, projects, update });
    });

    route(`${PREFIX}/root`, async (req, res) => {
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });
      const body = JSON.parse((await readBody(req)) || '{}');
      const path = String(body.path ?? '');
      if (!path.startsWith('/')) return send(res, 400, { ok: false, error: '必须是绝对路径' });
      await mkdir(path, { recursive: true });
      await saveConfig({ root: path });
      send(res, 200, { ok: true, root: path });
    });

    route(`${PREFIX}/build`, async (req, res) => {
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });
      const cfgNow = await loadConfig();
      const structure = await runNodeTool('build-structure.mjs', [cfgNow.root]);
      const excel = await runPythonTool('build-excel.py', [cfgNow.root]).catch((e) => ({ stdout: '', stderr: String(e?.message ?? e) }));
      send(res, 200, {
        ok: true,
        structure: structure.stdout.split('\n').slice(-4).join('\n'),
        excel: excel.stdout.split('\n').slice(-4).join('\n'),
        error: excel.stderr || null,
      });
    });

    route(`${PREFIX}/check-update`, async (req, res) => {
      send(res, 200, { ok: true, ...(await checkUpdate()) });
    });

    // 从仓库 dajunskill/ 拉取最新技能定义
    route(`${PREFIX}/update-skill`, async (req, res) => {
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });
      const cfgNow = await loadConfig();
      const info = await checkUpdate();
      if (info.error) return send(res, 400, { ok: false, error: info.error });
      const ref = info.latest?.sha || 'main';
      const pulled = await pullSkillFromRepo(cfgNow.repo, ref);
      await writeJson(STATE_PATH, { sha: info.latest?.sha ?? ref, version: (info.localVersion || '0.1.0') });
      send(res, 200, { ok: true, ...pulled, sha: info.latest?.sha ?? ref });
    });

    route(`${PREFIX}/schedule`, async (req, res) => {
      if (req.method === 'GET') {
        return send(res, 200, { ok: true, ...(await loadSchedule()), platform: process.platform });
      }
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });
      const body = JSON.parse((await readBody(req)) || '{}');
      const sched = await saveSchedule({
        enabled: body.enabled,
        hour: body.hour,
        minute: body.minute,
        scanRoot: body.scanRoot,
      });
      const applied = await writeLaunchd(sched);
      send(res, 200, { ok: true, ...sched, applied });
    });

    route(`${PREFIX}/pick`, async (req, res) => {
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });
      try {
        const { stdout } = await execFileAsync('osascript', [
          '-e', 'POSIX path of (choose folder with prompt "选择项目信息的根目录")',
        ], { timeout: 180_000 });
        const path = stdout.trim().replace(/\/$/, '');
        send(res, 200, { ok: true, path: path || null, cancelled: !path });
      } catch (error) {
        if (String(error?.stderr ?? '').includes('-128')) return send(res, 200, { ok: true, path: null, cancelled: true });
        throw error;
      }
    });

    route(`${PREFIX}/open`, async (req, res) => {
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method_not_allowed' });
      const body = JSON.parse((await readBody(req)) || '{}');
      const target = String(body.path || (await loadConfig()).root);
      await execFileAsync('open', [target]);
      send(res, 200, { ok: true, opened: target });
    });
  }

  ctx.on('dispose', () => {
    for (const d of disposers) { try { d?.(); } catch { /* 忽略 */ } }
  });

  /* ---------- 工具 ---------- */

  const reply = () => ({
    schema: { type: 'object', additionalProperties: true },
    render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }],
  });

  ctx.tools.register({
    name: 'wiki_build',
    description: '把 QQ 群聊原始归档整理成「结构层」（按天文件夹 + 聊天记录 + events.jsonl），并生成施工日志与单价台账 Excel。',
    parameters: {
      type: 'object',
      properties: { root: { type: 'string', description: '项目信息根目录（留空用当前配置）' } },
      required: [], additionalProperties: false,
    },
    output: reply(),
    execute: async (args) => {
      const cfgNow = await loadConfig();
      const root = String(args?.root || cfgNow.root);
      const structure = await runNodeTool('build-structure.mjs', [root]);
      const excel = await runPythonTool('build-excel.py', [root]).catch((e) => ({ stdout: '', stderr: String(e?.message ?? e) }));
      return {
        root,
        structure: structure.stdout,
        excel: excel.stdout,
        stderr: excel.stderr || structure.stderr || null,
      };
    },
  });

  ctx.tools.register({
    name: 'wiki_status',
    description: '查看施工 wiki 的根目录、已识别的项目、以及技能版本与更新状态。',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    output: reply(),
    execute: async () => {
      const cfgNow = await loadConfig();
      const { projects } = await listProjects();
      return { root: cfgNow.root, repo: cfgNow.repo, projects, update: await checkUpdate() };
    },
  });

  ctx.tools.register({
    name: 'wiki_check_update',
    description: '检查 GitHub 上技能仓库是否有新版本（只检查，不改动本地）。',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    output: reply(),
    execute: checkUpdate,
  });

  ctx.tools.register({
    name: 'wiki_update_skill',
    description: '从 GitHub 仓库的 dajunskill/ 目录拉取最新技能定义到本机（跨平台，不需要 git）。',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    output: reply(),
    execute: async () => {
      const cfgNow = await loadConfig();
      const info = await checkUpdate();
      if (info.error) return { ok: false, error: info.error };
      const pulled = await pullSkillFromRepo(cfgNow.repo, info.latest?.sha || 'main');
      await writeJson(STATE_PATH, { sha: info.latest?.sha ?? null, version: info.localVersion || '0.1.0' });
      return { ok: true, ...pulled, sha: info.latest?.sha ?? null };
    },
  });

  ctx.tools.register({
    name: 'wiki_schedule',
    description: '设置施工 Wiki 的每日自动整理时间（会写系统定时任务）。',
    parameters: {
      type: 'object',
      properties: {
        hour: { type: 'number', description: '0-23' },
        minute: { type: 'number', description: '0-59' },
        enabled: { type: 'boolean' },
        scanRoot: { type: 'string', description: '在哪个目录下查找「群聊归档」' },
      },
      required: [], additionalProperties: false,
    },
    output: reply(),
    execute: async (args) => {
      const sched = await saveSchedule(args ?? {});
      const applied = await writeLaunchd(sched);
      return { ...sched, applied };
    },
  });
  ctx.logger?.info?.(`construction-wiki 已加载；根目录 ${cfg.root}；仓库 ${cfg.repo}`);
}

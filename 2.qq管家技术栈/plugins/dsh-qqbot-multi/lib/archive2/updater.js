/**
 * 更新器：从 GitHub 仓库的「2.qq管家技术栈」拉取插件源码，覆盖到本机。
 *
 * 流程：clone/pull → 读 manifest.json → 比较版本 → 备份 → 复制 → 记录版本
 *
 * 设计约束：
 *   - 只覆盖 manifest 里 include 白名单列出的路径，不碰 node_modules 与本地数据
 *   - 拉取失败时不动本地任何文件
 *   - 覆盖前把目标目录备份到 update-cache/backup-<时间戳>/
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { promisify } from 'node:util';

const run = promisify(execFile);

const CACHE_ROOT = join(homedir(), '.dsh-qqbot', 'update-cache');
const REPO_DIR = join(CACHE_ROOT, 'nas-dajun');
const APPLIED_PATH = join(CACHE_ROOT, 'applied.json');
const DEFAULT_URL = 'git@github-nas-dajun:dawalixi1980/nas-dajun.git';
const DEFAULT_BASE = '2.qq管家技术栈';

function expandHome(path) {
    return path.startsWith('~') ? join(homedir(), path.slice(1)) : path;
}

function readJson(path, fallback) {
    try {
        if (!existsSync(path)) return fallback;
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        return fallback;
    }
}

async function ensureRepo(logger) {
    mkdirSync(CACHE_ROOT, { recursive: true });
    if (existsSync(join(REPO_DIR, '.git'))) {
        try {
            await run('git', ['-C', REPO_DIR, 'pull', '--ff-only'], { timeout: 120_000 });
            return { ok: true, cloned: false };
        } catch (err) {
            return { ok: false, error: `git pull 失败: ${err instanceof Error ? err.message : String(err)}` };
        }
    }
    try {
        await run('git', ['clone', '--depth', '1', DEFAULT_URL, REPO_DIR], { timeout: 180_000 });
        return { ok: true, cloned: true };
    } catch (err) {
        return { ok: false, error: `git clone 失败: ${err instanceof Error ? err.message : String(err)}` };
    }
}

/**
 * 检查并应用更新。
 * @returns {Promise<{ok:boolean, changed:boolean, version?:string, previous?:string, targets?:string[], restart?:boolean, error?:string}>}
 */
export async function updateFromRepo(logger) {
    const repo = await ensureRepo(logger);
    if (!repo.ok) return { ok: false, changed: false, error: repo.error };

    const manifestPath = join(REPO_DIR, DEFAULT_BASE, 'manifest.json');
    const manifest = readJson(manifestPath, null);
    if (manifest === null) {
        return { ok: false, changed: false, error: `仓库里找不到 ${DEFAULT_BASE}/manifest.json` };
    }

    const applied = readJson(APPLIED_PATH, {});
    if (applied.version === manifest.version) {
        return { ok: true, changed: false, version: manifest.version, previous: applied.version ?? '' };
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupRoot = join(CACHE_ROOT, `backup-${stamp}`);
    const done = [];
    let needRestart = false;

    try {
        for (const target of manifest.targets ?? []) {
            const sourceRoot = join(REPO_DIR, DEFAULT_BASE, target.source);
            const destRoot = expandHome(target.dest);
            if (!existsSync(sourceRoot)) {
                logger?.warn?.(`updater: 跳过 ${target.id}，源目录不存在 ${sourceRoot}`);
                continue;
            }
            for (const item of target.include ?? []) {
                const source = join(sourceRoot, item);
                if (!existsSync(source)) continue;
                const dest = join(destRoot, item);

                // 备份
                if (existsSync(dest)) {
                    const backup = join(backupRoot, target.id, item);
                    mkdirSync(join(backupRoot, target.id), { recursive: true });
                    cpSync(dest, backup, { recursive: true, force: true });
                }
                mkdirSync(destRoot, { recursive: true });
                rmSync(dest, { recursive: true, force: true });
                cpSync(source, dest, { recursive: true, force: true });
            }
            done.push(target.id);
            if (target.restart === true) needRestart = true;
        }
    } catch (err) {
        return { ok: false, changed: false, error: `复制失败: ${err instanceof Error ? err.message : String(err)}` };
    }

    writeFileSync(APPLIED_PATH, `${JSON.stringify({
        version: manifest.version,
        appliedAt: new Date().toISOString(),
        targets: done,
    }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });

    return {
        ok: true,
        changed: true,
        version: manifest.version,
        previous: applied.version ?? '',
        targets: done,
        restart: needRestart,
    };
}

/** 只查版本，不复制 */
export async function checkRepoVersion() {
    const repo = await ensureRepo(undefined);
    if (!repo.ok) return { ok: false, error: repo.error };
    const manifest = readJson(join(REPO_DIR, DEFAULT_BASE, 'manifest.json'), null);
    const applied = readJson(APPLIED_PATH, {});
    if (manifest === null) return { ok: false, error: '仓库里没有 manifest.json' };
    return {
        ok: true,
        remote: manifest.version,
        local: applied.version ?? '',
        outOfDate: applied.version !== manifest.version,
    };
}

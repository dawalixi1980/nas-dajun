/**
 * /github —— GitHub 仓库操作（自然语言说「上传到 github」「列一下我的仓库」同样生效）
 *
 *   /github list          列出账号下可上传的仓库（带公开/私有与最近推送时间）
 *   /github push [说明]   把本机技术栈仓库的改动提交并推送
 *
 * 凭据来源：GITHUB_TOKEN / GH_TOKEN 环境变量优先，其次复用 `git credential fill`
 * （Windows 凭据管理器 / macOS keychain），与 git 本身共用同一份凭据。
 */
import { spawnSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAgentCwd } from '../shared/index.js';

const execFileAsync = promisify(execFile);
const API_ROOT = 'https://api.github.com';
const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(HERE, '..', '..');

/** 读 GitHub 凭据：环境变量优先，其次复用 git 自己存的凭据 */
function readToken() {
    const env = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
    if (typeof env === 'string' && env.trim() !== '')
        return env.trim();
    try {
        const result = spawnSync('git', ['credential', 'fill'], {
            input: 'protocol=https\nhost=github.com\n\n',
            encoding: 'utf8',
            timeout: 5000,
        });
        const matched = /(?:^|\n)password=(.+)/.exec(result.stdout ?? '');
        return matched ? matched[1].trim() : '';
    }
    catch {
        return '';
    }
}

/** 从 start 往上找 .git，返回仓库根；找不到返回 null */
function findGitRoot(start) {
    let dir = resolve(start);
    for (let i = 0; i < 32; i++) {
        if (existsSync(resolve(dir, '.git')))
            return dir;
        const parent = dirname(dir);
        if (parent === dir)
            return null;
        dir = parent;
    }
    return null;
}

async function git(dir, args) {
    const result = await execFileAsync('git', ['-C', dir, ...args], { maxBuffer: 8 * 1024 * 1024 });
    return String(result.stdout ?? '').trim();
}

async function currentRepoInfo(dir) {
    try {
        const branch = (await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])) || '(未知)';
        const remote = (await git(dir, ['remote', 'get-url', 'origin'])) || '(未配置 origin)';
        const head = (await git(dir, ['log', '-1', '--format=%h %s'])) || '(还没有提交)';
        return { branch, remote, head };
    }
    catch {
        return null;
    }
}

async function listRepos() {
    const token = readToken();
    if (token === '')
        return '⚠️ 本机没有可用的 GitHub 凭据。\n先在终端跑一次 `gh auth login`，或把 GITHUB_TOKEN 配到环境变量里。';
    let response;
    try {
        response = await fetch(`${API_ROOT}/user/repos?per_page=100&sort=pushed&direction=desc&affiliation=owner`, {
            headers: {
                authorization: `Bearer ${token}`,
                accept: 'application/vnd.github+json',
                'user-agent': 'dsh-qqbot-multi',
            },
        });
    }
    catch (err) {
        return `⚠️ 连不上 GitHub：${err instanceof Error ? err.message : String(err)}`;
    }
    if (!response.ok)
        return `⚠️ GitHub 返回 ${response.status}：${(await response.text()).slice(0, 200)}`;
    const repos = await response.json();
    if (!Array.isArray(repos) || repos.length === 0)
        return '账号下还没有仓库。';
    const lines = [`### 你有 ${repos.length} 个仓库`, ''];
    for (const repo of repos.slice(0, 20)) {
        const flag = repo.private ? '🔒' : '🌐';
        const pushed = String(repo.pushed_at ?? '').slice(0, 10);
        lines.push(`${flag} \`${repo.full_name}\` — ${pushed || '无推送记录'}`);
    }
    if (repos.length > 20)
        lines.push('', `…… 还有 ${repos.length - 20} 个未显示`);
    lines.push('', '上传：`/github push [说明]`');
    return lines.join('\n');
}

async function pushChanges(repoDir, note) {
    const info = await currentRepoInfo(repoDir);
    if (info === null)
        return '⚠️ 找不到 git 仓库，无法上传。';
    await git(repoDir, ['add', '-A']);
    const changed = await git(repoDir, ['status', '--porcelain']);
    if (changed === '')
        return [`✅ 没有需要上传的改动`, `仓库：${info.remote}`, `分支：${info.branch}`].join('\n');
    const files = changed.split('\n').filter(Boolean);
    const message = note.trim() !== ''
        ? note.trim()
        : `chore: 来自 QQ 机器人的更新 ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    try {
        await git(repoDir, ['commit', '-m', message]);
    }
    catch (err) {
        return `⚠️ 提交失败：${err instanceof Error ? err.message : String(err)}`;
    }
    let sha = '';
    try {
        sha = await git(repoDir, ['rev-parse', '--short', 'HEAD']);
        await git(repoDir, ['push', 'origin', 'HEAD']);
    }
    catch (err) {
        return [
            `⚠️ 推送失败（本地已提交 ${sha}）：`,
            err instanceof Error ? err.message : String(err),
        ].join('\n');
    }
    return [
        `✅ 已上传到 ${info.remote}`,
        `提交：\`${sha}\` ${message}`,
        `文件：${files.length} 个`,
        ...files.slice(0, 10).map(line => `  ${line}`),
        ...(files.length > 10 ? [`  …… 还有 ${files.length - 10} 个`] : []),
    ].join('\n');
}

export function githubCommand({ config, logger }) {
    return {
        name: 'github',
        category: 'qqbot',
        scope: 'all',
        description: '列出仓库 / 上传代码到 GitHub',
        usage: [
            '/github list        列出账号下的仓库',
            '/github push        提交并推送本机技术栈仓库',
            '/github push 说明   带提交说明推送',
            '',
            '自然语言也可以：「列出我的仓库」「把改动传到 github」',
        ].join('\n'),
        async handler(cmdCtx) {
            const args = (cmdCtx.command?.args ?? []).map(item => String(item));
            const sub = (args[0] ?? '').toLowerCase();
            const repoDir = findGitRoot(PLUGIN_ROOT) ?? findGitRoot(resolveAgentCwd(config.cwd));
            if (sub === '' || sub === 'status') {
                const info = repoDir === null ? null : await currentRepoInfo(repoDir);
                if (info === null)
                    return '当前不在 git 仓库里。用法：\n/github list\n/github push [说明]';
                return [
                    `仓库：${info.remote}`,
                    `分支：${info.branch}`,
                    `最新提交：${info.head}`,
                    '',
                    '/github push   提交并上传',
                    '/github list   看账号下的仓库',
                ].join('\n');
            }
            if (sub === 'list' || sub === 'ls' || sub === '仓库')
                return listRepos();
            if (sub === 'push' || sub === '上传') {
                if (repoDir === null)
                    return '⚠️ 找不到 git 仓库目录，无法上传。';
                return pushChanges(repoDir, args.slice(1).join(' '));
            }
            logger?.info?.(`/github 未知子命令: ${sub}`);
            return `不认识「${sub}」。用法：\n/github list\n/github push [说明]`;
        },
    };
}

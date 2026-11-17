/**
 * 自动化任务存储：~/.dsh-qqbot/automations.json（0600）。
 *
 * 不复用 cordis.patch.yml：任务是频繁增删的数据，写 patch 会触发插件重载，
 * 把正在跑的会话/长轮询全部打断。任务模型/机器人都在 action.botId 里引用，
 * 机器人列表本身仍以 patch 为准。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PLUGIN_HOME } from '../shared/dirs.js';

export const TASKS_PATH = join(PLUGIN_HOME, 'automations.json');

export function loadTasks(path = TASKS_PATH) {
    try {
        if (!existsSync(path))
            return [];
        const data = JSON.parse(readFileSync(path, 'utf8'));
        const list = Array.isArray(data) ? data : Array.isArray(data?.tasks) ? data.tasks : [];
        return list.filter(task => task && typeof task === 'object' && typeof task.id === 'string');
    }
    catch {
        return [];
    }
}

export function saveTasks(tasks, path = TASKS_PATH) {
    try {
        mkdirSync(dirname(path), { recursive: true });
        const tmp = `${path}.${process.pid}.tmp`;
        writeFileSync(tmp, JSON.stringify(tasks, null, 2), { encoding: 'utf8', mode: 0o600 });
        renameSync(tmp, path);
        return true;
    }
    catch {
        return false;
    }
}

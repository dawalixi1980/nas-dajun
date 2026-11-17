/**
 * 静音归档：群消息只落盘，不唤醒模型、不回复。
 * 输出：~/.dsh-qqbot/archive/YYYY-MM-DD.jsonl（每行一个事件）
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PLUGIN_HOME } from '../shared/dirs.js';

export const ARCHIVE_ROOT = join(PLUGIN_HOME, 'archive');

export async function appendArchive(event) {
    const date = new Date(event.time ?? Date.now());
    const pad = value => String(value).padStart(2, '0');
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    await mkdir(ARCHIVE_ROOT, { recursive: true });
    const line = `${JSON.stringify({ ...event, time: date.toISOString() })}\n`;
    await appendFile(join(ARCHIVE_ROOT, `${day}.jsonl`), line, 'utf8');
}

#!/usr/bin/env node
/**
 * LLBot → dsh-qq-access 事件转发器
 *
 * 为什么需要：
 *   dsh-qq-access 的事件接口（:5701/onebot）强制校验 X-Signature（HMAC-SHA1），
 *   而 LLBot 的 http-post 只发事件体，不带这个头。
 *
 * 做法：
 *   收 LLBot 的 HTTP POST → 用 events.secret 计算 HMAC-SHA1 → 带 X-Signature 转发到 5701。
 *
 * 只做转发，不改内容、不存数据。
 */
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();
const CONFIG = join(HOME, '.dsh-qq-access', 'config.json');
const LISTEN = Number(process.env.LLBOT_SHIM_PORT || 5702);
const TARGET = `http://127.0.0.1:${process.env.LLBOT_TARGET_PORT || 5701}/onebot`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 读 events.secret；配置可能还没生成，重试几次。 */
async function loadSecret() {
  for (let i = 0; i < 30; i += 1) {
    try {
      const raw = JSON.parse(await readFile(CONFIG, 'utf8'));
      if (raw?.events?.secret) return raw.events.secret;
    } catch { /* 继续等 */ }
    await sleep(2000);
  }
  throw new Error(`读不到 events.secret：${CONFIG}`);
}

const secret = await loadSecret();

const server = createServer(async (req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, forwarding: TARGET }));
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405).end();
    return;
  }
  const chunks = [];
  try {
    for await (const chunk of req) chunks.push(chunk);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const body = Buffer.concat(chunks);
  const sig = 'sha1=' + createHmac('sha1', secret).update(body).digest('hex');

  try {
    const upstream = await fetch(TARGET, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Signature': sig },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    // 把上游状态回传，让 LLBot 侧能看到失败
    res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
    res.end(await upstream.text());
  } catch (error) {
    console.error(new Date().toISOString(), '转发失败', error?.message ?? error);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'forward_failed' }));
  }
});

server.listen(LISTEN, '127.0.0.1', () => {
  console.log(`${new Date().toISOString()} 签名转发器已启动：:${LISTEN} → ${TARGET}`);
});

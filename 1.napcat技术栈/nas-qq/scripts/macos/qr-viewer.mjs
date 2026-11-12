#!/usr/bin/env node
/**
 * 二维码查看器：本地 HTTP 服务，页面每 3 秒自动刷新，始终显示最新的登录二维码。
 *
 * 为什么不用 file:// 打开 HTML：
 *   浏览器对 file:// 页面加载其他本地文件有安全限制，图片经常不显示。
 *   用 HTTP 服务就没有这个问题。
 *
 * 用法：node qr-viewer.mjs   然后打开 http://127.0.0.1:3099
 */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';

const QR = join(homedir(), 'llbot', 'bin', 'llbot', 'data', 'temp', 'login-qrcode.png');
const PORT = Number(process.env.QR_PORT || 3099);

const PAGE = `<!doctype html><meta charset="utf-8">
<meta http-equiv="refresh" content="3">
<title>QQ 登录二维码</title>
<body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#fff;font-family:-apple-system,'PingFang SC',sans-serif">
  <div style="font-size:16px;color:#333;margin-bottom:14px;font-weight:500">用手机 QQ 扫码登录</div>
  <img src="/qr" width="400" height="400" style="border:1px solid #eee;border-radius:8px">
  <div style="font-size:13px;color:#999;margin-top:14px">页面每 3 秒自动刷新 · <span id="t"></span></div>
  <div style="font-size:13px;color:#c00;margin-top:6px">扫码前确认手机上是小号（不是主号）</div>
  <script>document.getElementById('t').textContent = new Date().toLocaleTimeString()</script>
</body>`;

const server = createServer(async (req, res) => {
  if (req.url === '/qr') {
    try {
      const buf = await readFile(QR);
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      res.end(buf);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('二维码还没生成');
    }
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(PAGE);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`二维码查看器已启动：http://127.0.0.1:${PORT}`);
});

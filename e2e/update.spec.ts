import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

test('an installed older worker updates and reloads the app on the next focus check', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'The service-worker lifecycle is independent of viewport.');
  const root = resolve('dist');
  let latest = false;
  const oldWorker = `self.addEventListener('install', e => e.waitUntil(self.skipWaiting()));
    self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
    self.addEventListener('message', e => { if(e.data === 'version') e.ports[0].postMessage('old'); });`;
  const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
  const server = createServer(async (req, res) => {
    const path = new URL(req.url!, 'http://localhost').pathname;
    if (path === '/sw.js' && !latest) { res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }); res.end(oldWorker); return; }
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + sep)) { res.writeHead(404).end(); return; }
    try { const data = await readFile(file); res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as { port: number };
    await page.addInitScript(() => sessionStorage.setItem('loads', String(Number(sessionStorage.getItem('loads') ?? 0) + 1)));
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    expect(await page.evaluate(async () => {
      const channel = new MessageChannel();
      const answer = new Promise(resolve => { channel.port1.onmessage = e => resolve(e.data); });
      navigator.serviceWorker.controller!.postMessage('version', [channel.port2]);
      return answer;
    })).toBe('old');
    const loads = await page.evaluate(() => Number(sessionStorage.getItem('loads')));
    latest = true;
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(() => page.evaluate(() => Number(sessionStorage.getItem('loads'))).catch(() => -1), { timeout: 30000 }).toBe(loads + 1);
    await expect(page.getByText('Gas Turbine Lab').first()).toBeVisible();
    await expect.poll(() => page.evaluate(async () => (await caches.keys()).some(key => key.includes('workbox-precache')))).toBe(true);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

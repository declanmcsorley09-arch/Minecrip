// Headless screenshot helper: node scripts/shot.mjs <url> <out.png> [waitMs]
import { chromium } from 'playwright-core';
const [url, out, wait = '8000'] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(url);
await page.waitForTimeout(Number(wait));
const stats = await page.evaluate(() => {
  const s = window.__stats;
  if (!s) return null;
  return { chunks: s.world.chunks.size, sections: s.chunkRenderer.stats, pending: s.streamer.pendingCount };
}).catch((e) => String(e));
await page.screenshot({ path: out });
console.log(JSON.stringify(stats));
console.log(logs.join('\n'));
await browser.close();

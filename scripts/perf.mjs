/**
 * Performance probe: creates a world at render distance 8, flies across the
 * terrain to force continuous chunk streaming and prints the main-thread
 * frame breakdown from the in-game profiler.
 *
 * Usage: node scripts/perf.mjs [baseUrl]
 */
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:5173';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.goto(base);
await page.waitForSelector('.main-menu');
const t0 = Date.now();
await page.evaluate(async () => {
  const app = window.__app;
  app.settings.set('renderDistance', 8);
  const world = await app.createWorld({ name: 'Perf', seed: 'perf', gameMode: 'creative' });
  app.playWorld(world);
});
await page.waitForFunction(() => window.__app.game?.ready, null, { timeout: 180000 });
console.log(`world ready in ${Date.now() - t0} ms`);
await page.evaluate(() => {
  const app = window.__app;
  app.ui.closeAll();
  app.game.resume();
  app.game.player.flying = true;
});
// Fly forward and sample the profiler.
const samples = [];
for (let i = 0; i < 6; i++) {
  await page.evaluate(() => {
    const g = window.__app.game;
    const p = g.player.position;
    g.player.teleport(p.x + 24, Math.max(p.y, 110), p.z + 8);
  });
  await page.waitForTimeout(4000);
  samples.push(await page.evaluate(() => {
    const d = window.__app.game.debugInfo();
    return { fps: d.fps, frameMs: +d.frameTime.toFixed(2), chunks: d.chunks, pendingChunks: d.pendingChunks, meshes: d.meshes, visible: d.visibleMeshes, pendingMeshes: d.pendingMeshes, draws: d.drawCalls, tris: d.triangles, profile: Object.fromEntries(d.profile.map(([k, v]) => [k, +v.toFixed(2)])) };
  }));
}
for (const s of samples) console.log(JSON.stringify(s));
await browser.close();

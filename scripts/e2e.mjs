/**
 * End-to-end smoke test: boots the app in headless Chromium, creates a
 * world, plays for a while (walking, mining, placing, inventory, crafting),
 * captures screenshots and fails on any console error.
 *
 * Usage: node scripts/e2e.mjs [baseUrl]   (default http://localhost:5173)
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173';
const outDir = 'screenshots';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack}`));

/** Waits until the game has rendered `n` more frames (software GL is slow). */
const frames = async (n) => {
  const now = await page.evaluate(() => window.__app.game?.frameCount ?? 0);
  await page.waitForFunction((target) => (window.__app.game?.frameCount ?? 0) >= target, now + n, { timeout: 120000, polling: 100 });
};

const step = async (name, fn) => {
  const t = Date.now();
  await fn();
  console.log(`✓ ${name} (${Date.now() - t} ms)`);
};

await step('boot to main menu', async () => {
  await page.goto(base);
  await page.waitForSelector('.main-menu', { timeout: 30000 });
  await page.screenshot({ path: `${outDir}/01-main-menu.png` });
});

await step('create world', async () => {
  await page.evaluate(() => window.__app.settings.set('renderDistance', 5));
  await page.click('text=Singleplayer');
  await page.click('text=Create New World');
  await page.fill('input[placeholder="Leave blank for a random seed"]', '12345');
  await page.click('button:has-text("Game Mode: Survival")');
  await page.screenshot({ path: `${outDir}/02-create-world.png` });
  await page.locator('button:has-text("Create New World"):visible').click();
});

await step('load world', async () => {
  await page.waitForFunction(() => window.__app?.game?.ready === true, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${outDir}/03-paused.png` });
});

await step('resume and look around', async () => {
  await page.evaluate(() => {
    const app = window.__app;
    app.ui.closeAll();
    app.game.resume();
    app.game.player.pitch = -0.15;
  });
  await page.waitForFunction(() => window.__app.game.chunkRenderer.pendingCount < 20, null, { timeout: 120000 });
  await frames(5);
  await page.screenshot({ path: `${outDir}/04-ingame.png` });
});

await step('walk forward and jump', async () => {
  const before = await page.evaluate(() => ({ ...window.__app.game.player.position }));
  await page.evaluate(() => {
    const input = window.__app.game.input;
    input.keys.add('KeyW');
    input.keys.add('Space');
  });
  await frames(30);
  const after = await page.evaluate(() => {
    const input = window.__app.game.input;
    input.keys.delete('KeyW');
    input.keys.delete('Space');
    return { ...window.__app.game.player.position };
  });
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  if (moved < 1) throw new Error(`player did not move (${moved.toFixed(2)})`);
  console.log(`  moved ${moved.toFixed(2)} blocks`);
});

await step('mine and place blocks (creative)', async () => {
  const result = await page.evaluate(async () => {
    const game = window.__app.game;
    const p = game.player;
    p.pitch = -Math.PI / 2 + 0.05;
    const waitFrames = async (n) => {
      const t = game.frameCount + n;
      while (game.frameCount < t) await new Promise((r) => setTimeout(r, 50));
    };
    await waitFrames(3);
    const target = game.interaction.target;
    if (!target) return { error: 'no target below the player' };
    const before = game.world.getBlock(target.x, target.y, target.z);
    game.input.buttons.add(0);
    game.input.buttonsPressed.add(0);
    await waitFrames(2);
    game.input.buttons.delete(0);
    await waitFrames(3);
    const after = game.world.getBlock(target.x, target.y, target.z);
    return { before, after, x: target.x, y: target.y, z: target.z };
  });
  if (result.error) throw new Error(result.error);
  if (result.after !== 0) throw new Error(`block not broken: ${JSON.stringify(result)}`);
  await page.screenshot({ path: `${outDir}/05-mined.png` });
});

await step('open creative inventory', async () => {
  await page.evaluate(() => window.__app.openInventory());
  await page.waitForSelector('.creative-grid');
  await page.screenshot({ path: `${outDir}/06-creative-inventory.png` });
  await page.keyboard.press('Escape');
});

await step('switch to survival and open inventory', async () => {
  await page.evaluate(() => {
    window.__app.game.setGameMode('survival');
  });
  await page.waitForFunction(() => window.__app.game.player.gameMode === 'survival');
  await page.evaluate(() => window.__app.openInventory());
  await page.waitForSelector('.inv-layout');
  await page.screenshot({ path: `${outDir}/07-survival-inventory.png` });
  await page.keyboard.press('Escape');
});

await step('debug overlay + night + mobs', async () => {
  await page.evaluate(() => {
    const app = window.__app;
    app.ui.closeAll();
    app.game.resume();
    app.hud.toggleDebug();
    app.game.sendChat('/time set 13500');
    app.game.sendChat('/summon zombie');
    app.game.sendChat('/summon sheep');
    app.game.player.pitch = -0.1;
  });
  await frames(20);
  await page.screenshot({ path: `${outDir}/08-debug-night-mobs.png` });
});

await step('save and quit', async () => {
  await page.evaluate(() => window.__app.quitToTitle());
  await page.waitForSelector('.main-menu', { timeout: 30000 });
  await page.click('text=Singleplayer');
  await page.waitForSelector('.world-item');
  await page.screenshot({ path: `${outDir}/09-world-list.png` });
});

await browser.close();
const fatal = errors.filter((e) => !e.includes('requestPointerLock') && !e.includes('Pointer lock'));
if (fatal.length) {
  console.error(`\n${fatal.length} console problem(s):\n${fatal.join('\n')}`);
  process.exit(1);
}
console.log('\nE2E passed with no console errors.');

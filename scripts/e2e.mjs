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
  try {
    await fn();
  } catch (err) {
    await page.screenshot({ path: `${outDir}/failure.png` }).catch(() => {});
    console.error(`✗ ${name}`);
    throw err;
  }
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

/** Index of the first visible slot element holding an item (by registry name). */
const slotIndexOf = (name, { output = false } = {}) =>
  page.evaluate(([n, out]) => {
    const screen = window.__app.ui.top;
    const els = [...document.querySelectorAll('.slot-cell')];
    const view = screen.views.find((v) => (out ? v.slot.output : !v.slot.output && !v.slot.palette) && v.slot.get()?.def?.name === n);
    return view ? els.indexOf(view.el) : -1;
  }, [name, output]);
const slotCenter = async (i) => {
  const box = await page.locator('.slot-cell').nth(i).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
/** Shift-clicks a slot using raw mouse/keyboard input. */
const shiftClickSlot = async (i) => {
  const c = await slotCenter(i);
  await page.keyboard.down('Shift');
  await page.mouse.click(c.x, c.y);
  await page.keyboard.up('Shift');
};
const invCount = (name) => page.evaluate((n) => {
  const inv = window.__app.game.player.inventory;
  return inv.slots.reduce((sum, s) => sum + (s && s.def.name === n ? s.count : 0), 0);
}, name);

await step('craft planks and a crafting table with the mouse', async () => {
  await page.evaluate(() => {
    const app = window.__app;
    app.ui.closeAll();
    app.game.resume();
    app.game.player.inventory.clear();
    app.game.sendChat('/give oak_log 4');
  });
  await page.waitForFunction(() => window.__app.game.player.inventory.get(0)?.count === 4);
  await page.evaluate(() => window.__app.openInventory());
  await page.waitForSelector('.inv-layout');
  // Click the logs, place them in the first crafting cell, shift-click the result.
  await page.locator('.slot-cell').nth(await slotIndexOf('oak_log')).click();
  await page.locator('.slot-cell').nth(0).click();
  const out = await slotIndexOf('oak_planks', { output: true });
  if (out < 0) throw new Error('planks recipe did not match');
  await page.locator('.slot-cell').nth(out).click({ modifiers: ['Shift'] });
  if ((await invCount('oak_planks')) !== 16) throw new Error(`expected 16 planks, got ${await invCount('oak_planks')}`);
  // Drag the planks across the 2x2 grid to split them evenly.
  await page.locator('.slot-cell').nth(await slotIndexOf('oak_planks')).click();
  const cells = await Promise.all([0, 1, 2, 3].map(slotCenter));
  await page.mouse.move(cells[0].x, cells[0].y);
  await page.mouse.down();
  for (const c of cells.slice(1)) await page.mouse.move(c.x, c.y, { steps: 4 });
  await page.mouse.up();
  const table = await slotIndexOf('crafting_table', { output: true });
  if (table < 0) throw new Error('crafting table recipe did not match after drag distribution');
  await page.locator('.slot-cell').nth(table).click({ modifiers: ['Shift'] });
  if ((await invCount('crafting_table')) < 1) throw new Error('crafting table not crafted');
  await page.screenshot({ path: `${outDir}/10-crafted.png` });
  await page.keyboard.press('KeyE');
  await page.waitForSelector('.inv-layout', { state: 'detached' });
});

await step('place and use a crafting table', async () => {
  const opened = await page.evaluate(async () => {
    const app = window.__app;
    app.ui.closeAll();
    app.game.resume();
    const game = app.game;
    const inv = game.player.inventory;
    const idx = inv.slots.findIndex((s) => s && s.def.name === 'crafting_table');
    const table = inv.get(idx);
    inv.set(idx, null);
    inv.set(0, table);
    inv.select(0);
    const wait = async (n) => { const t = game.frameCount + n; while (game.frameCount < t) await new Promise((r) => setTimeout(r, 30)); };
    const rightClick = async () => {
      game.input.buttons.add(2);
      game.input.buttonsPressed.add(2);
      await wait(2);
      game.input.buttons.delete(2);
      await wait(3);
    };
    // Aim at the ground a couple of blocks ahead, place, then use the table.
    game.player.pitch = -0.62;
    await wait(3);
    const t = game.interaction.target;
    await rightClick();
    // Tall grass is replaced in place; solid ground gets the block on top.
    const placed = game.world.getBlock(t.x, t.y, t.z) === 23 || game.world.getBlock(t.x + t.nx, t.y + t.ny, t.z + t.nz) === 23;
    if (!placed) return { placed, target: { x: t.x, y: t.y, z: t.z, id: t.id } };
    await wait(2);
    await rightClick();
    return { placed, top: window.__app.ui.top?.constructor.name };
  });
  if (opened.top !== 'CraftingTableScreen') throw new Error(`crafting table did not open: ${JSON.stringify(opened)}`);
  await page.screenshot({ path: `${outDir}/11-crafting-table.png` });
  await page.keyboard.press('Escape');
});

await step('smelt iron in a furnace', async () => {
  await page.evaluate(() => {
    const app = window.__app;
    app.ui.closeAll();
    app.game.resume();
    app.game.sendChat('/give iron_ore 3');
    app.game.sendChat('/give coal 1');
    const p = app.game.player.position;
    const x = Math.floor(p.x) + 2;
    const z = Math.floor(p.z);
    const y = app.game.world.getHeight(x, z);
    app.game.world.setBlock(x, y, z, 24);
    app.openContainer({ x, y, z, kind: 'furnace' });
  });
  await page.waitForSelector('.flame');
  await page.waitForFunction(() => window.__app.game.player.inventory.slots.some((s) => s?.def.name === 'coal'));
  // Shift-click routes ore to the input and coal to the fuel slot.
  await shiftClickSlot(await slotIndexOf('iron_ore'));
  await shiftClickSlot(await slotIndexOf('coal'));
  const state = await page.evaluate(() => {
    const f = window.__app.ui.top.furnace;
    for (let i = 0; i < 260; i++) f.tick(0.25);
    return { input: f.input?.count ?? 0, output: f.output?.count ?? 0, fuel: f.fuel?.count ?? 0 };
  });
  if (state.output !== 3) throw new Error(`furnace output ${JSON.stringify(state)}`);
  await frames(3);
  await page.screenshot({ path: `${outDir}/12-furnace.png` });
  await shiftClickSlot(await slotIndexOf('iron_ingot', { output: true }));
  if ((await invCount('iron_ingot')) !== 3) throw new Error('ingots not collected');
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

let snapshot;
await step('save and quit', async () => {
  snapshot = await page.evaluate(() => {
    const g = window.__app.game;
    const inv = g.player.inventory.toJSON().filter(Boolean).map((s) => `${s.id}x${s.count}`).sort();
    let furnace = null;
    g.world.forEachBlockEntity((be, x, y, z) => { furnace = { x, y, z, output: be.output?.count ?? 0, block: g.world.getBlock(x, y, z) }; });
    const p = g.player.position;
    return { x: p.x, y: p.y, z: p.z, inv, furnace, time: g.serverCycle.time };
  });
  await page.evaluate(() => window.__app.quitToTitle());
  await page.waitForSelector('.main-menu', { timeout: 30000 });
  await page.click('text=Singleplayer');
  await page.waitForSelector('.world-item');
  await page.screenshot({ path: `${outDir}/09-world-list.png` });
});

await step('reload world and verify persistence', async () => {
  await page.click('.world-item');
  await page.click('text=Play Selected World');
  await page.waitForFunction(() => window.__app.game?.ready === true, null, { timeout: 120000 });
  await frames(5);
  const loaded = await page.evaluate(() => {
    const g = window.__app.game;
    const inv = g.player.inventory.toJSON().filter(Boolean).map((s) => `${s.id}x${s.count}`).sort();
    const p = g.player.position;
    return { x: p.x, y: p.y, z: p.z, inv, time: g.serverCycle.time, mode: g.player.gameMode };
  });
  if (Math.hypot(loaded.x - snapshot.x, loaded.z - snapshot.z) > 0.5) throw new Error(`position not restored: ${JSON.stringify(loaded)} vs ${JSON.stringify(snapshot)}`);
  if (loaded.inv.join() !== snapshot.inv.join()) throw new Error(`inventory not restored: ${loaded.inv} vs ${snapshot.inv}`);
  if (Math.abs(loaded.time - snapshot.time) > 200) throw new Error(`time not restored: ${loaded.time} vs ${snapshot.time}`);
  if (loaded.mode !== 'survival') throw new Error('game mode not restored');
  if (snapshot.furnace) {
    const f = snapshot.furnace;
    await page.waitForFunction((pos) => {
      const w = window.__app.game.world;
      return w.getChunk(pos.x >> 4, pos.z >> 4) && w.getBlockEntity(pos.x, pos.y, pos.z);
    }, f, { timeout: 60000 });
    const block = await page.evaluate((pos) => window.__app.game.world.getBlock(pos.x, pos.y, pos.z), f);
    if (block !== f.block) throw new Error(`furnace block not restored (${block} vs ${f.block})`);
  }
  await page.evaluate(() => window.__app.quitToTitle());
  await page.waitForSelector('.main-menu', { timeout: 30000 });
});

await browser.close();
const fatal = errors.filter((e) => !e.includes('requestPointerLock') && !e.includes('Pointer lock'));
if (fatal.length) {
  console.error(`\n${fatal.length} console problem(s):\n${fatal.join('\n')}`);
  process.exit(1);
}
console.log('\nE2E passed with no console errors.');

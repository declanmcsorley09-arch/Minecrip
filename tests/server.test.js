import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGenerator } from '../src/terrain/TerrainGenerator.js';
import { World } from '../src/world/World.js';
import { Chunk } from '../src/world/Chunk.js';
import { computeChunkLight } from '../src/world/ChunkLighting.js';
import { DayNightCycle } from '../src/world/DayNightCycle.js';
import { Weather } from '../src/world/Weather.js';
import { GameServer } from '../src/networking/GameServer.js';
import { GameClient } from '../src/networking/GameClient.js';
import { createLocalTransportPair } from '../src/networking/LocalTransport.js';
import { Pathfinder } from '../src/entities/ai/Pathfinder.js';
import { BlockIds } from '../src/blocks/index.js';
import { ItemIds } from '../src/items/index.js';

function setup(seed = 4242, radius = 2) {
  const gen = new TerrainGenerator(seed);
  const world = new World(seed);
  for (let cx = -radius; cx <= radius; cx++) for (let cz = -radius; cz <= radius; cz++) {
    const g = gen.generate(cx, cz);
    const light = new Uint8Array(g.blocks.length);
    computeChunkLight(g.blocks, light, g.heightmap);
    world.addChunk(new Chunk(cx, cz, { ...g, light }));
  }
  const spawnY = world.getHeight(8, 8);
  const server = new GameServer({ world, cycle: new DayNightCycle(6000), weather: new Weather(), spawn: { x: 8.5, y: spawnY, z: 8.5 }, rules: { mobSpawning: false } });
  const [ct, st] = createLocalTransportPair();
  server.accept(st, { sharedWorld: true });
  const client = new GameClient(ct, { world, sharedWorld: true });
  return { world, server, client, spawnY };
}

function step(server, client, seconds = 0.05) {
  const n = Math.round(seconds / 0.05);
  for (let i = 0; i < n; i++) { server.update(0.05); client.pump(); }
}

test('handshake, block edits and validation', () => {
  const { world, server, client, spawnY } = setup();
  let welcome = null;
  client.on('welcome', (m) => { welcome = m; });
  client.connect('Tester', 'survival');
  step(server, client);
  assert.ok(welcome);
  assert.equal(welcome.seed, 4242);
  client.sendPlayerState({ x: 8.5, y: spawnY, z: 8.5, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true });
  step(server, client);
  // Place within reach
  client.placeBlock(9, spawnY, 8, BlockIds.cobblestone);
  step(server, client);
  assert.equal(world.getBlock(9, spawnY, 8), BlockIds.cobblestone);
  // Out-of-reach placement is rejected
  let rejected = 0;
  client.on('blockRejected', () => rejected++);
  client.placeBlock(30, spawnY + 5, 30, BlockIds.cobblestone);
  step(server, client);
  assert.equal(rejected, 1);
  assert.equal(world.getBlock(30, spawnY + 5, 30), 0);
  // Placing inside the player is rejected
  client.placeBlock(8, spawnY, 8, BlockIds.stone);
  step(server, client);
  assert.equal(rejected, 2);
  // Breaking in survival with a pickaxe drops an item entity
  client.breakBlock(9, spawnY, 8, ItemIds.wooden_pickaxe);
  step(server, client, 0.1);
  assert.equal(world.getBlock(9, spawnY, 8), 0);
  const items = [...client.entities.values()].filter((e) => e.type === 'item');
  assert.equal(items.length, 1);
  assert.equal(items[0].data.id, ItemIds.cobblestone);
  // Pickup after the delay
  let picked = null;
  client.on('pickup', (m) => { picked = m; });
  step(server, client, 1.0);
  client.requestPickup(items[0].id, 64);
  step(server, client, 0.1);
  assert.equal(picked?.stack.id, ItemIds.cobblestone);
  step(server, client, 0.1);
  assert.equal([...client.entities.values()].filter((e) => e.type === 'item').length, 0);
});

test('fall damage, death and respawn', () => {
  const { server, client, spawnY } = setup();
  const health = [];
  let died = false;
  client.on('health', (m) => health.push(m.health));
  client.on('died', () => { died = true; });
  client.connect('Faller', 'survival');
  step(server, client);
  client.chat(`/tp 8.5 ${spawnY + 12} 8.5`);
  step(server, client);
  for (let i = 0; i <= 10; i++) {
    client.sendPlayerState({ x: 8.5, y: spawnY + 12 - i * 1.2, z: 8.5, yaw: 0, pitch: 0, onGround: false });
    step(server, client);
  }
  client.sendPlayerState({ x: 8.5, y: spawnY, z: 8.5, yaw: 0, pitch: 0, onGround: true });
  step(server, client);
  assert.ok(health.length > 0 && health[health.length - 1] <= 20 - 8, `health ${health}`);
  client.chat('/kill');
  step(server, client);
  assert.ok(died);
  let respawned = null;
  client.on('respawn', (m) => { respawned = m; });
  client.respawn();
  step(server, client);
  assert.equal(respawned.health, 20);
});

test('mobs spawn, animals panic, zombies chase and hurt players', () => {
  const { server, client, spawnY } = setup(99);
  client.connect('Hunter', 'survival');
  step(server, client);
  client.sendPlayerState({ x: 8.5, y: spawnY, z: 8.5, yaw: 0, pitch: 0, onGround: true });
  step(server, client);
  server.cycle.setDayTime(18000);
  const zombie = server.spawner.spawn(server.ctx, 'zombie', 14.5, server.world.getHeight(14, 8), 8.5);
  let hurt = false;
  client.on('health', (m) => { if (m.cause === 'zombie') hurt = true; });
  for (let i = 0; i < 200 && !hurt; i++) {
    client.sendPlayerState({ x: 8.5, y: spawnY, z: 8.5, yaw: 0, pitch: 0, onGround: true });
    step(server, client);
  }
  assert.ok(hurt, `zombie at ${zombie.x.toFixed(1)},${zombie.y.toFixed(1)},${zombie.z.toFixed(1)}`);
  // Attack it to death
  for (let i = 0; i < 10 && !zombie.dead; i++) {
    client.attack(zombie.id, ItemIds.diamond_sword, false);
    step(server, client, 0.6);
  }
  assert.ok(zombie.dead);
});

test('pathfinder navigates around obstacles and up steps', () => {
  const blocks = new Map();
  const world = { getBlock: (x, y, z) => blocks.get(`${x},${y},${z}`) ?? (y <= 10 ? BlockIds.stone : 0) };
  for (let z = -5; z <= 5; z++) { blocks.set(`5,11,${z}`, BlockIds.stone); blocks.set(`5,12,${z}`, BlockIds.stone); }
  blocks.set('8,11,0', BlockIds.stone);
  const pf = new Pathfinder(world);
  const path = pf.findPath(0, 11, 0, 10, 11, 0, { height: 2 });
  assert.ok(path && path.length > 0);
  const last = path[path.length - 1];
  assert.equal(last.x, 10);
  assert.ok(path.some((p) => Math.abs(p.z) >= 6), 'went around the wall');
  assert.ok(!path.some((p) => p.x === 5 && Math.abs(p.z) <= 5 && p.y <= 12), 'never inside the wall');
});

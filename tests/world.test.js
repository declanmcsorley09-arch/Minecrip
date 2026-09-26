import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGenerator } from '../src/terrain/TerrainGenerator.js';
import { World } from '../src/world/World.js';
import { Chunk } from '../src/world/Chunk.js';
import { computeChunkLight } from '../src/world/ChunkLighting.js';
import { BlockIds } from '../src/blocks/index.js';
import { SeededRandom } from '../src/utils/random.js';

function buildWorld(seed, radius = 1, ox = 0, oz = 0) {
  const gen = new TerrainGenerator(seed);
  const world = new World(seed);
  for (let cx = ox - radius; cx <= ox + radius; cx++) {
    for (let cz = oz - radius; cz <= oz + radius; cz++) {
      const g = gen.generate(cx, cz);
      const light = new Uint8Array(g.blocks.length);
      computeChunkLight(g.blocks, light, g.heightmap);
      world.addChunk(new Chunk(cx, cz, { ...g, light }));
    }
  }
  return world;
}

function recomputeLight(world) {
  const fresh = new World(world.seed);
  const chunks = [...world.chunks.values()].reverse(); // different order exercises border merging
  for (const c of chunks) {
    const copy = new Chunk(c.cx, c.cz, { blocks: c.blocks.slice(), heightmap: c.heightmap.slice(), light: new Uint8Array(c.blocks.length) });
    copy.recomputeHeightmap();
    computeChunkLight(copy.blocks, copy.light, copy.heightmap);
    fresh.addChunk(copy);
  }
  return fresh;
}

test('generation is deterministic and plausible', () => {
  const a = new TerrainGenerator(777).generate(5, 9);
  const b = new TerrainGenerator(777).generate(5, 9);
  assert.deepEqual(a.blocks, b.blocks);
  assert.equal(a.blocks[0], BlockIds.bedrock);
  let water = 0, stone = 0;
  for (const id of a.blocks) { if (id === BlockIds.stone) stone++; if (id === BlockIds.water) water++; }
  assert.ok(stone > 5000);
});

test('sky light is full above terrain and dark in solid rock', () => {
  const world = buildWorld(4242);
  for (let x = 0; x < 16; x += 5) for (let z = 0; z < 16; z += 5) {
    const h = world.getHeight(x, z);
    assert.equal(world.getSkyLight(x, h + 1, z), 15);
    assert.equal(world.getSkyLight(x, 200, z), 15);
  }
});

test('torch placement and removal update block light', () => {
  const world = buildWorld(99);
  const x = 8, z = 8;
  const y = world.getHeight(x, z) + 1;
  world.setBlock(x, y, z, BlockIds.torch);
  assert.equal(world.getBlockLight(x, y, z), 14);
  assert.equal(world.getBlockLight(x + 1, y, z), 13);
  assert.equal(world.getBlockLight(x + 3, y + 1, z), 10);
  world.setBlock(x, y, z, 0);
  assert.equal(world.getBlockLight(x, y, z), 0);
  assert.equal(world.getBlockLight(x + 1, y, z), 0);
});

test('incremental lighting matches a full recompute after random edits', () => {
  const world = buildWorld(2024);
  const rng = new SeededRandom(5);
  const ids = [0, BlockIds.stone, BlockIds.glass, BlockIds.torch, BlockIds.oak_leaves, BlockIds.glow_crystal, BlockIds.water, 0, 0];
  for (let i = 0; i < 400; i++) {
    const x = rng.int(-8, 23), z = rng.int(-8, 23);
    const h = world.getHeight(x, z);
    const y = rng.int(Math.max(1, h - 12), Math.min(250, h + 6));
    world.setBlock(x, y, z, rng.pick(ids), { notify: false });
  }
  const fresh = recomputeLight(world);
  let mismatches = 0;
  for (const c of world.chunks.values()) {
    const f = fresh.getChunk(c.cx, c.cz);
    for (let i = 0; i < c.light.length; i++) if (c.light[i] !== f.light[i]) mismatches++;
  }
  assert.equal(mismatches, 0);
});

test('gravity blocks fall and unsupported plants pop', () => {
  const world = buildWorld(31337);
  const falls = [], pops = [];
  world.on('blockFall', (e) => falls.push(e));
  world.on('blockPopped', (e) => pops.push(e));
  const x = 4, z = 4;
  const h = world.getHeight(x, z);
  world.setBlock(x, h + 3, z, BlockIds.sand);
  for (let i = 0; i < 3; i++) world.tick();
  assert.equal(falls.length, 1);
  assert.equal(world.getBlock(x, h + 3, z), 0);
  // plant on dirt, then remove the dirt
  world.setBlock(x + 2, h + 1, z, BlockIds.dirt);
  world.setBlock(x + 2, h + 2, z, BlockIds.poppy);
  world.tick(); world.tick();
  world.setBlock(x + 2, h + 1, z, 0);
  world.tick(); world.tick();
  assert.equal(world.getBlock(x + 2, h + 2, z), 0);
  assert.ok(pops.some((p) => p.id === BlockIds.poppy));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SimplexNoise } from '../src/utils/noise/SimplexNoise.js';
import { FractalNoise } from '../src/utils/noise/FractalNoise.js';
import { SeededRandom, seedFromString, hash2 } from '../src/utils/random.js';
import { IntQueue } from '../src/utils/IntQueue.js';
import { MinHeap } from '../src/utils/MinHeap.js';
import { LRUCache } from '../src/utils/LRUCache.js';
import { chunkKey, chunkKeyX, chunkKeyZ } from '../src/utils/coords.js';
import { blockRegistry, BlockIds } from '../src/blocks/index.js';
import { itemRegistry, ItemIds } from '../src/items/index.js';
import { getBreakTime, canHarvest, rollDrops } from '../src/items/Mining.js';

test('simplex noise is deterministic and bounded', () => {
  const a = new SimplexNoise(1234);
  const b = new SimplexNoise(1234);
  const c = new SimplexNoise(99);
  let min = Infinity, max = -Infinity, diff = 0;
  for (let i = 0; i < 5000; i++) {
    const x = i * 0.137, y = i * 0.071, z = i * 0.311;
    const v2 = a.noise2D(x, y), v3 = a.noise3D(x, y, z);
    assert.equal(v2, b.noise2D(x, y));
    assert.equal(v3, b.noise3D(x, y, z));
    if (v2 !== c.noise2D(x, y)) diff++;
    min = Math.min(min, v2, v3); max = Math.max(max, v2, v3);
  }
  assert.ok(min >= -1.01 && max <= 1.01, `range ${min}..${max}`);
  assert.ok(max > 0.5 && min < -0.5);
  assert.ok(diff > 4000);
});

test('fractal noise is normalised', () => {
  const f = new FractalNoise(42, { octaves: 5, frequency: 0.01 });
  for (let i = 0; i < 1000; i++) {
    const v = f.sample2D(i * 3.1, i * 1.7);
    assert.ok(v >= -1 && v <= 1);
    const r = f.ridged2D(i * 3.1, i * 1.7);
    assert.ok(r >= 0 && r <= 1);
  }
});

test('seeded random + seed parsing', () => {
  assert.equal(seedFromString('12345'), 12345);
  assert.equal(seedFromString('hello'), seedFromString('hello'));
  assert.notEqual(seedFromString('hello'), seedFromString('world'));
  const r1 = new SeededRandom(7), r2 = new SeededRandom(7);
  for (let i = 0; i < 100; i++) assert.equal(r1.next(), r2.next());
  assert.equal(hash2(1, 2, 3), hash2(1, 2, 3));
});

test('chunk keys round-trip', () => {
  for (const [x, z] of [[0, 0], [-1, 5], [123456, -98765], [-8000000, 8000000]]) {
    const k = chunkKey(x, z);
    assert.equal(chunkKeyX(k), x);
    assert.equal(chunkKeyZ(k), z);
    assert.ok(Number.isSafeInteger(k * 16 + 15));
  }
});

test('int queue grows and preserves order', () => {
  const q = new IntQueue(3, 4);
  for (let i = 0; i < 100; i++) q.push(i, i * 2, i * 3);
  const out = [0, 0, 0];
  for (let i = 0; i < 100; i++) {
    assert.ok(q.pop(out));
    assert.deepEqual(out, [i, i * 2, i * 3]);
  }
  assert.equal(q.pop(out), false);
});

test('min heap orders by priority', () => {
  const h = new MinHeap();
  const vals = [5, 3, 9, 1, 7, 2, 8];
  for (const v of vals) h.push(`v${v}`, v);
  const out = [];
  while (h.size) out.push(h.pop());
  assert.deepEqual(out, ['v1', 'v2', 'v3', 'v5', 'v7', 'v8', 'v9']);
});

test('lru cache evicts oldest', () => {
  const evicted = [];
  const c = new LRUCache(2, (k) => evicted.push(k));
  c.set('a', 1); c.set('b', 2); c.get('a'); c.set('c', 3);
  assert.deepEqual(evicted, ['b']);
});

test('block registry tables', () => {
  assert.equal(BlockIds.air, 0);
  assert.equal(blockRegistry.opaque[BlockIds.stone], 1);
  assert.equal(blockRegistry.opaque[BlockIds.glass], 0);
  assert.equal(blockRegistry.opaque[BlockIds.oak_leaves], 0);
  assert.equal(blockRegistry.solid[BlockIds.water], 0);
  assert.equal(blockRegistry.emission[BlockIds.torch], 14);
  assert.equal(blockRegistry.filter[BlockIds.stone], 15);
  const grassTop = blockRegistry.textureOf(BlockIds.grass_block, 2);
  assert.equal(blockRegistry.textureNames[grassTop], 'grass_top');
  assert.ok(blockRegistry.textureNames.includes('destroy_9'));
});

test('item registry and mining rules', () => {
  assert.equal(ItemIds.stone, BlockIds.stone);
  assert.ok(ItemIds.diamond_pickaxe >= 300);
  assert.equal(itemRegistry.get(ItemIds.stick).maxStack, 64);
  assert.equal(itemRegistry.get(ItemIds.iron_sword).maxStack, 1);
  assert.equal(itemRegistry.itemForBlock(BlockIds.oak_log_x), ItemIds.oak_log);
  assert.equal(itemRegistry.itemForBlock(BlockIds.lit_furnace_east), ItemIds.furnace);
  assert.equal(canHarvest(BlockIds.stone, 0), false);
  assert.equal(canHarvest(BlockIds.stone, ItemIds.wooden_pickaxe), true);
  assert.equal(canHarvest(BlockIds.diamond_ore, ItemIds.stone_pickaxe), false);
  assert.equal(canHarvest(BlockIds.diamond_ore, ItemIds.iron_pickaxe), true);
  assert.equal(getBreakTime(BlockIds.dirt, 0), 0.75);
  assert.ok(getBreakTime(BlockIds.stone, ItemIds.wooden_pickaxe) < getBreakTime(BlockIds.stone, 0));
  assert.equal(getBreakTime(BlockIds.bedrock, ItemIds.diamond_pickaxe), Infinity);
  assert.equal(getBreakTime(BlockIds.torch, 0), 0);
  assert.deepEqual(rollDrops(BlockIds.stone, ItemIds.wooden_pickaxe), [{ id: ItemIds.cobblestone, count: 1 }]);
  assert.deepEqual(rollDrops(BlockIds.grass_block, 0), [{ id: ItemIds.dirt, count: 1 }]);
  assert.deepEqual(rollDrops(BlockIds.glass, 0), []);
});

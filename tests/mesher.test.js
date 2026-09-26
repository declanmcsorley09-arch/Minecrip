import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChunkMesher, PADDED_VOLUME, paddedIndex, facesConnected, VISIBILITY_ALL } from '../src/renderer/ChunkMesher.js';
import { BlockIds } from '../src/blocks/index.js';

function emptySection() {
  const blocks = new Uint8Array(PADDED_VOLUME);
  const light = new Uint8Array(PADDED_VOLUME).fill(0xf0);
  const climate = new Uint8Array(256).fill(0x88);
  return { blocks, light, climate };
}
const quads = (m) => (m ? m.indices.length / 6 : 0);

test('single block produces six quads', () => {
  const { blocks, light, climate } = emptySection();
  blocks[paddedIndex(5, 5, 5)] = BlockIds.stone;
  const r = new ChunkMesher().mesh(blocks, light, climate, 0, 0, 0);
  assert.equal(quads(r.opaque), 6);
  assert.equal(r.cutout, null);
  assert.equal(r.visibility, VISIBILITY_ALL);
});

test('flat uniformly lit layer merges into few quads', () => {
  const { blocks, light, climate } = emptySection();
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) { blocks[paddedIndex(x, 0, z)] = BlockIds.stone; light[paddedIndex(x, 0, z)] = 0; }
  // neighbours in padding are also stone so side faces at the border are hidden
  for (let x = -1; x <= 16; x++) for (let z = -1; z <= 16; z++) { if (x < 0 || x > 15 || z < 0 || z > 15) { blocks[paddedIndex(x, 0, z)] = BlockIds.stone; light[paddedIndex(x, 0, z)] = 0; } blocks[paddedIndex(x, -1, z)] = BlockIds.stone; light[paddedIndex(x, -1, z)] = 0; }
  const r = new ChunkMesher().mesh(blocks, light, climate, 0, 0, 0);
  assert.equal(quads(r.opaque), 1);
});

test('adjacent glass faces are culled, leaves are not', () => {
  const { blocks, light, climate } = emptySection();
  blocks[paddedIndex(2, 2, 2)] = BlockIds.glass;
  blocks[paddedIndex(3, 2, 2)] = BlockIds.glass;
  blocks[paddedIndex(8, 2, 2)] = BlockIds.oak_leaves;
  blocks[paddedIndex(9, 2, 2)] = BlockIds.oak_leaves;
  const r = new ChunkMesher().mesh(blocks, light, climate, 0, 0, 0);
  // glass: 6 merged faces; leaves: 6 merged + 2 inner faces
  assert.equal(quads(r.cutout), 6 + 8);
  const fast = new ChunkMesher().mesh(blocks, light, climate, 0, 0, 0, { fancyLeaves: false });
  assert.equal(quads(fast.cutout), 12);
});

test('water surface is lowered and plants are double sided', () => {
  const { blocks, light, climate } = emptySection();
  blocks[paddedIndex(4, 4, 4)] = BlockIds.water;
  blocks[paddedIndex(10, 4, 4)] = BlockIds.poppy;
  const r = new ChunkMesher().mesh(blocks, light, climate, 0, 0, 0);
  assert.equal(quads(r.translucent), 6);
  let maxY = 0;
  for (let i = 1; i < r.translucent.positions.length; i += 3) maxY = Math.max(maxY, r.translucent.positions[i]);
  assert.equal(maxY, 5 - 0.125);
  assert.equal(quads(r.cutout), 4);
});

test('visibility graph detects a sealed wall', () => {
  const { blocks, light, climate } = emptySection();
  for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) blocks[paddedIndex(8, y, z)] = BlockIds.stone;
  const r = new ChunkMesher().mesh(blocks, light, climate, 0, 0, 0);
  assert.equal(facesConnected(r.visibility, 0, 1), false); // +X cannot see -X
  assert.equal(facesConnected(r.visibility, 2, 3), true); // top sees bottom (on each side)
  assert.equal(facesConnected(r.visibility, 0, 2), true);
});

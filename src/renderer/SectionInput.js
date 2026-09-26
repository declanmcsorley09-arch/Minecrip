import { PADDED, PADDED_VOLUME } from './ChunkMesher.js';
import { BlockIds } from '../blocks/index.js';
import { CHUNK_HEIGHT } from '../world/constants.js';

/**
 * Extracts the padded (18³) block and light arrays for one render section
 * from the world. The one-block border comes from neighbouring sections and
 * chunks so the worker-side mesher is completely self-contained.
 */

/**
 * @typedef {object} SectionInput
 * @property {Uint8Array} blocks
 * @property {Uint8Array} light
 * @property {Uint8Array} climate
 */

/**
 * Fills padded arrays for section (cx, sy, cz).
 * @param {import('../world/World.js').World} world
 * @param {number} cx
 * @param {number} sy
 * @param {number} cz
 * @param {Uint8Array} blocks output, length PADDED_VOLUME
 * @param {Uint8Array} light output, length PADDED_VOLUME
 * @returns {boolean} false when a required chunk is missing
 */
export function fillSectionInput(world, cx, sy, cz, blocks, light) {
  const y0 = sy * 16 - 1;
  const chunks = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const c = world.getChunk(cx + dx, cz + dz);
      if (!c) return false;
      chunks.push(c);
    }
  }
  for (let pz = 0; pz < PADDED; pz++) {
    const lzw = pz - 1; // -1..16 relative to chunk
    const czo = lzw < 0 ? 0 : lzw > 15 ? 2 : 1;
    const lz = lzw & 15;
    for (let px = 0; px < PADDED; px++) {
      const lxw = px - 1;
      const cxo = lxw < 0 ? 0 : lxw > 15 ? 2 : 1;
      const lx = lxw & 15;
      const chunk = chunks[czo * 3 + cxo];
      const col = lx | (lz << 4);
      const cb = chunk.blocks;
      const cl = chunk.light;
      let o = px + pz * PADDED;
      for (let py = 0; py < PADDED; py++, o += PADDED * PADDED) {
        const y = y0 + py;
        if (y < 0) {
          blocks[o] = BlockIds.bedrock;
          light[o] = 0;
        } else if (y >= CHUNK_HEIGHT) {
          blocks[o] = 0;
          light[o] = 0xf0;
        } else {
          const i = col | (y << 8);
          blocks[o] = cb[i];
          light[o] = cl[i];
        }
      }
    }
  }
  return true;
}

/**
 * Allocates a pair of padded arrays.
 * @returns {{blocks: Uint8Array, light: Uint8Array}}
 */
export function createSectionBuffers() {
  return { blocks: new Uint8Array(PADDED_VOLUME), light: new Uint8Array(PADDED_VOLUME) };
}

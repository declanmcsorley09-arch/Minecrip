import { blockRegistry } from '../blocks/index.js';
import { IntQueue } from '../utils/IntQueue.js';
import { CHUNK_HEIGHT, MAX_LIGHT } from './constants.js';

/**
 * Chunk-local initial lighting. Runs inside generation workers: sky light is
 * filled straight down each column and then flood-filled sideways, and block
 * light is flood-filled from emitters — all without leaving the chunk.
 * Cross-chunk propagation is finished on the main thread by the
 * {@link import('./LightEngine.js').LightEngine} when neighbours meet.
 * @module world/ChunkLighting
 */

const queue = new IntQueue(1, 16384);

/**
 * Fills `light` for a chunk from its `blocks` and `heightmap`.
 * @param {Uint8Array} blocks
 * @param {Uint8Array} light output, packed sky<<4 | block
 * @param {Uint8Array} heightmap
 */
export function computeChunkLight(blocks, light, heightmap) {
  const opaque = blockRegistry.opaque;
  const filter = blockRegistry.filter;
  const emission = blockRegistry.emission;
  light.fill(0);

  // 1. Direct sky light down each column. Uses exactly the same rule as the
  //    flood fill: full strength continues only through unfiltered blocks.
  for (let col = 0; col < 256; col++) {
    let level = MAX_LIGHT;
    for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
      const idx = col | (y << 8);
      const id = blocks[idx];
      if (opaque[id]) break;
      const f = filter[id];
      if (level !== MAX_LIGHT || f !== 0) level -= 1 + f;
      if (level <= 0) break;
      light[idx] = level << 4;
    }
  }

  // 2. Seed cells that can brighten a horizontal neighbour.
  queue.clear();
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      const col = x | (z << 4);
      let top = heightmap[col];
      if (x > 0) top = Math.max(top, heightmap[col - 1]);
      if (x < 15) top = Math.max(top, heightmap[col + 1]);
      if (z > 0) top = Math.max(top, heightmap[col - 16]);
      if (z < 15) top = Math.max(top, heightmap[col + 16]);
      top = Math.min(top + 1, CHUNK_HEIGHT - 1);
      for (let y = 0; y <= top; y++) {
        const idx = col | (y << 8);
        const l = light[idx] >> 4;
        if (l < 2) continue;
        const need = l - 1;
        if (
          (x > 0 && !opaque[blocks[idx - 1]] && light[idx - 1] >> 4 < need) ||
          (x < 15 && !opaque[blocks[idx + 1]] && light[idx + 1] >> 4 < need) ||
          (z > 0 && !opaque[blocks[idx - 16]] && light[idx - 16] >> 4 < need) ||
          (z < 15 && !opaque[blocks[idx + 16]] && light[idx + 16] >> 4 < need)
        ) {
          queue.push(idx);
        }
      }
    }
  }
  floodLocal(blocks, light, true);

  // 3. Block light from emitters.
  queue.clear();
  for (let i = 0; i < blocks.length; i++) {
    const e = emission[blocks[i]];
    if (e > 0) {
      light[i] = (light[i] & 0xf0) | e;
      queue.push(i);
    }
  }
  floodLocal(blocks, light, false);
}

const out = new Int32Array(1);

/**
 * BFS flood fill restricted to the chunk.
 * @param {Uint8Array} blocks
 * @param {Uint8Array} light
 * @param {boolean} sky true for sky channel, false for block channel
 */
function floodLocal(blocks, light, sky) {
  const opaque = blockRegistry.opaque;
  const filter = blockRegistry.filter;
  while (queue.pop(out)) {
    const idx = out[0];
    const level = sky ? light[idx] >> 4 : light[idx] & 15;
    if (level <= 1) continue;
    const x = idx & 15;
    const z = (idx >> 4) & 15;
    const y = idx >> 8;
    for (let d = 0; d < 6; d++) {
      let n;
      switch (d) {
        case 0:
          if (x === 15) continue;
          n = idx + 1;
          break;
        case 1:
          if (x === 0) continue;
          n = idx - 1;
          break;
        case 2:
          if (y === CHUNK_HEIGHT - 1) continue;
          n = idx + 256;
          break;
        case 3:
          if (y === 0) continue;
          n = idx - 256;
          break;
        case 4:
          if (z === 15) continue;
          n = idx + 16;
          break;
        default:
          if (z === 0) continue;
          n = idx - 16;
      }
      const id = blocks[n];
      if (opaque[id]) continue;
      const f = filter[id];
      const nl = sky && d === 3 && level === MAX_LIGHT && f === 0 ? MAX_LIGHT : level - 1 - f;
      if (nl <= 0) continue;
      if (sky) {
        if (light[n] >> 4 < nl) {
          light[n] = (light[n] & 15) | (nl << 4);
          queue.push(n);
        }
      } else if ((light[n] & 15) < nl) {
        light[n] = (light[n] & 0xf0) | nl;
        queue.push(n);
      }
    }
  }
}

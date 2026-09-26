import { TerrainGenerator } from '../terrain/TerrainGenerator.js';
import { computeChunkLight } from '../world/ChunkLighting.js';
import { ChunkMesher } from '../renderer/ChunkMesher.js';
import { collectTransferables } from '../renderer/GeometryBuffer.js';
import { CHUNK_VOLUME, CHUNK_HEIGHT, LAYER_AREA } from '../world/constants.js';

/**
 * Background worker for the two expensive per-chunk jobs:
 * - `generate`: terrain generation (+ saved modifications) and initial light
 * - `relight`: initial light for cached block data
 * - `mesh`: greedy meshing of one padded section
 * All buffers are transferred, never copied.
 */

let generator = null;
const mesher = new ChunkMesher();

/**
 * Recomputes a heightmap from block data.
 * @param {Uint8Array} blocks
 * @param {Uint8Array} heightmap
 */
function computeHeightmap(blocks, heightmap) {
  for (let col = 0; col < LAYER_AREA; col++) {
    let y = CHUNK_HEIGHT - 1;
    while (y > 0 && blocks[col | (y << 8)] === 0) y--;
    heightmap[col] = y + 1;
  }
}

/**
 * Applies packed modifications (index << 8 | id).
 * @param {Uint8Array} blocks
 * @param {Uint32Array|null} mods
 */
function applyMods(blocks, mods) {
  if (!mods) return;
  for (let i = 0; i < mods.length; i++) {
    const v = mods[i];
    blocks[v >>> 8] = v & 255;
  }
}

self.onmessage = (event) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      generator = new TerrainGenerator(msg.seed);
      break;
    case 'generate': {
      const blocks = msg.blocks && msg.blocks.length === CHUNK_VOLUME ? msg.blocks : new Uint8Array(CHUNK_VOLUME);
      const light = msg.light && msg.light.length === CHUNK_VOLUME ? msg.light : new Uint8Array(CHUNK_VOLUME);
      const gen = generator.generate(msg.cx, msg.cz, blocks);
      if (msg.mods) {
        applyMods(blocks, msg.mods);
        computeHeightmap(blocks, gen.heightmap);
      }
      computeChunkLight(blocks, light, gen.heightmap);
      self.postMessage(
        { type: 'generated', id: msg.id, cx: msg.cx, cz: msg.cz, blocks, light, heightmap: gen.heightmap, biomes: gen.biomes, climate: gen.climate },
        [blocks.buffer, light.buffer, gen.heightmap.buffer, gen.biomes.buffer, gen.climate.buffer],
      );
      break;
    }
    case 'relight': {
      const light = msg.light && msg.light.length === CHUNK_VOLUME ? msg.light : new Uint8Array(CHUNK_VOLUME);
      const heightmap = new Uint8Array(LAYER_AREA);
      computeHeightmap(msg.blocks, heightmap);
      computeChunkLight(msg.blocks, light, heightmap);
      self.postMessage(
        { type: 'relit', id: msg.id, cx: msg.cx, cz: msg.cz, blocks: msg.blocks, light, heightmap },
        [msg.blocks.buffer, light.buffer, heightmap.buffer],
      );
      break;
    }
    case 'mesh': {
      const result = mesher.mesh(msg.blocks, msg.light, msg.climate, msg.ox, msg.oy, msg.oz, msg.options);
      const transfer = [msg.blocks.buffer, msg.light.buffer];
      collectTransferables(result.opaque, transfer);
      collectTransferables(result.cutout, transfer);
      collectTransferables(result.translucent, transfer);
      self.postMessage(
        { type: 'meshed', id: msg.id, key: msg.key, version: msg.version, blocks: msg.blocks, light: msg.light, ...result },
        transfer,
      );
      break;
    }
    default:
      throw new Error(`Unknown worker message ${msg.type}`);
  }
};

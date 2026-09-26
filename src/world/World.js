import { EventEmitter } from '../utils/EventEmitter.js';
import { chunkKey, sectionKey } from '../utils/coords.js';
import { blockRegistry } from '../blocks/index.js';
import { canBlockStay } from '../blocks/BlockBehaviors.js';
import { LightEngine } from './LightEngine.js';
import { CHUNK_HEIGHT } from './constants.js';

/**
 * Authoritative voxel world state: the set of loaded chunks plus block
 * access, lighting and scheduled block updates. Contains no rendering code,
 * so it runs unchanged on a client, in an integrated server, or headless.
 *
 * Events:
 * - `blockChanged` ({x, y, z, prev, id, cause})
 * - `chunkAdded` (chunk) / `chunkRemoved` (chunk)
 * - `blockFall` ({x, y, z, id}) — a gravity block lost its support
 * - `blockPopped` ({x, y, z, id}) — an unsupported block broke naturally
 */
export class World extends EventEmitter {
  /**
   * @param {number} seed world seed
   */
  constructor(seed) {
    super();
    this.seed = seed >>> 0;
    /** @type {Map<number, import('./Chunk.js').Chunk>} */
    this.chunks = new Map();
    this.lighting = new LightEngine(this);
    /** Section keys whose meshes must be rebuilt. @type {Set<number>} */
    this.dirtySections = new Set();
    /** Scheduled block updates: "x,y,z" → tick due. @type {Map<string, {x:number,y:number,z:number,due:number}>} */
    this.scheduledUpdates = new Map();
    this.tickCount = 0;
    this.lastChunk = null;
  }

  /**
   * @param {number} cx
   * @param {number} cz
   * @returns {import('./Chunk.js').Chunk|undefined}
   */
  getChunk(cx, cz) {
    const last = this.lastChunk;
    if (last && last.cx === cx && last.cz === cz) return last;
    const c = this.chunks.get(chunkKey(cx, cz));
    if (c) this.lastChunk = c;
    return c;
  }

  /**
   * Whether the chunk containing world column (x, z) is loaded.
   * @param {number} x
   * @param {number} z
   * @returns {boolean}
   */
  isLoaded(x, z) {
    return !!this.getChunk(Math.floor(x) >> 4, Math.floor(z) >> 4);
  }

  /**
   * Block id at integer world coordinates (0 when unloaded / out of range).
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {number}
   */
  getBlock(x, y, z) {
    if (y < 0 || y >= CHUNK_HEIGHT) return 0;
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return 0;
    return c.blocks[(x & 15) | ((z & 15) << 4) | (y << 8)];
  }

  /**
   * Packed light (sky<<4 | block) at a position. Above the world returns full sky.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {number}
   */
  getLight(x, y, z) {
    if (y >= CHUNK_HEIGHT) return 0xf0;
    if (y < 0) return 0;
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return 0xf0;
    return c.light[(x & 15) | ((z & 15) << 4) | (y << 8)];
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {number} 0..15
   */
  getSkyLight(x, y, z) {
    return this.getLight(x, y, z) >> 4;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {number} 0..15
   */
  getBlockLight(x, y, z) {
    return this.getLight(x, y, z) & 15;
  }

  /**
   * Effective light level combining sky (scaled by daylight) and block light.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} daylight 0..1 sky brightness
   * @returns {number} 0..15
   */
  getEffectiveLight(x, y, z, daylight) {
    const l = this.getLight(x, y, z);
    return Math.max(Math.round((l >> 4) * daylight), l & 15);
  }

  /**
   * Y of the first air block above the terrain in column (x, z).
   * @param {number} x
   * @param {number} z
   * @returns {number}
   */
  getHeight(x, z) {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return 0;
    return c.heightmap[(x & 15) | ((z & 15) << 4)];
  }

  /**
   * Changes a block, updating lighting, meshes and neighbours.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} id
   * @param {object} [options]
   * @param {boolean} [options.track=true] record as a saved modification
   * @param {boolean} [options.notify=true] schedule neighbour updates
   * @param {string} [options.cause='player'] reason, forwarded in events
   * @returns {boolean} true if the block changed
   */
  setBlock(x, y, z, id, { track = true, notify = true, cause = 'player' } = {}) {
    if (y < 0 || y >= CHUNK_HEIGHT) return false;
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return false;
    const lx = x & 15;
    const lz = z & 15;
    const prev = c.setBlock(lx, y, lz, id, track);
    if (prev === id) return false;
    const idx = lx | (lz << 4) | (y << 8);
    if (c.blockEntities.has(idx) && blockRegistry.get(prev).interaction !== blockRegistry.get(id).interaction) {
      c.blockEntities.delete(idx);
    }
    this.lighting.onBlockChanged(x, y, z, prev, id);
    this.markBlockDirty(x, y, z);
    if (notify) {
      this.scheduleUpdate(x, y, z, 1);
      this.scheduleUpdate(x + 1, y, z, 1);
      this.scheduleUpdate(x - 1, y, z, 1);
      this.scheduleUpdate(x, y + 1, z, 1);
      this.scheduleUpdate(x, y - 1, z, 1);
      this.scheduleUpdate(x, y, z + 1, 1);
      this.scheduleUpdate(x, y, z - 1, 1);
    }
    this.emit('blockChanged', { x, y, z, prev, id, cause });
    return true;
  }

  /**
   * Schedules a block update check after `delay` ticks.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} delay ticks
   */
  scheduleUpdate(x, y, z, delay) {
    if (y < 0 || y >= CHUNK_HEIGHT) return;
    const key = `${x},${y},${z}`;
    const due = this.tickCount + delay;
    const existing = this.scheduledUpdates.get(key);
    if (existing && existing.due <= due) return;
    this.scheduledUpdates.set(key, { x, y, z, due });
  }

  /**
   * Advances scheduled block updates (support checks and gravity).
   * Called once per server tick.
   */
  tick() {
    this.tickCount++;
    if (this.scheduledUpdates.size === 0) return;
    const due = [];
    for (const [key, u] of this.scheduledUpdates) {
      if (u.due <= this.tickCount) {
        due.push(u);
        this.scheduledUpdates.delete(key);
      }
    }
    for (const u of due) this.runBlockUpdate(u.x, u.y, u.z);
  }

  /**
   * Evaluates a single block update.
   * @private
   */
  runBlockUpdate(x, y, z) {
    const id = this.getBlock(x, y, z);
    if (id === 0 || !this.getChunk(x >> 4, z >> 4)) return;
    const reg = blockRegistry;
    if (reg.gravity[id]) {
      const below = this.getBlock(x, y - 1, z);
      if (y > 0 && (below === 0 || reg.fluid[below] || (reg.replaceable[below] && !reg.solid[below]))) {
        this.setBlock(x, y, z, 0, { cause: 'fall' });
        this.emit('blockFall', { x, y, z, id });
      }
      return;
    }
    if (reg.get(id).support && !canBlockStay(this, x, y, z, id)) {
      this.setBlock(x, y, z, 0, { cause: 'pop' });
      this.emit('blockPopped', { x, y, z, id });
    }
  }

  /**
   * Inserts a generated chunk and stitches its lighting with neighbours.
   * @param {import('./Chunk.js').Chunk} chunk
   */
  addChunk(chunk) {
    this.chunks.set(chunkKey(chunk.cx, chunk.cz), chunk);
    this.lastChunk = null;
    this.lighting.mergeChunk(chunk);
    this.emit('chunkAdded', chunk);
  }

  /**
   * Removes a chunk from the world.
   * @param {number} cx
   * @param {number} cz
   * @returns {import('./Chunk.js').Chunk|undefined} the removed chunk
   */
  removeChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    const chunk = this.chunks.get(key);
    if (!chunk) return undefined;
    this.chunks.delete(key);
    this.lastChunk = null;
    this.lighting.resetCache();
    for (let sy = 0; sy < 16; sy++) this.dirtySections.delete(sectionKey(cx, sy, cz));
    this.emit('chunkRemoved', chunk);
    return chunk;
  }

  /**
   * Marks every render section whose padded mesh input contains (x, y, z).
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  markBlockDirty(x, y, z) {
    const cx = x >> 4;
    const cz = z >> 4;
    const sy = y >> 4;
    const lx = x & 15;
    const ly = y & 15;
    const lz = z & 15;
    const x0 = lx === 0 ? -1 : 0;
    const x1 = lx === 15 ? 1 : 0;
    const y0 = ly === 0 && sy > 0 ? -1 : 0;
    const y1 = ly === 15 && sy < 15 ? 1 : 0;
    const z0 = lz === 0 ? -1 : 0;
    const z1 = lz === 15 ? 1 : 0;
    const set = this.dirtySections;
    for (let dx = x0; dx <= x1; dx++) {
      for (let dz = z0; dz <= z1; dz++) {
        for (let dy = y0; dy <= y1; dy++) set.add(sectionKey(cx + dx, sy + dy, cz + dz));
      }
    }
  }

  /**
   * Block entity (furnace state...) at a position.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {object|undefined}
   */
  getBlockEntity(x, y, z) {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return undefined;
    return c.blockEntities.get((x & 15) | ((z & 15) << 4) | (y << 8));
  }

  /**
   * Stores a block entity at a position.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {object} entity
   */
  setBlockEntity(x, y, z, entity) {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return;
    c.blockEntities.set((x & 15) | ((z & 15) << 4) | (y << 8), entity);
    c.dirty = true;
  }

  /**
   * Iterates all block entities in loaded chunks.
   * @param {(entity: object, x: number, y: number, z: number, chunk: import('./Chunk.js').Chunk) => void} fn
   */
  forEachBlockEntity(fn) {
    for (const chunk of this.chunks.values()) {
      for (const [idx, be] of chunk.blockEntities) {
        fn(be, (chunk.cx << 4) + (idx & 15), idx >> 8, (chunk.cz << 4) + ((idx >> 4) & 15), chunk);
      }
    }
  }
}

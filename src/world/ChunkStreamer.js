import { Chunk } from './Chunk.js';
import { CHUNK_VOLUME } from './constants.js';
import { chunkKey } from '../utils/coords.js';
import { LRUCache } from '../utils/LRUCache.js';
import { ObjectPool } from '../utils/ObjectPool.js';

/**
 * Streams chunks in and out around a focus point.
 *
 * - Chunks within `renderDistance + 1` are requested nearest-first from the
 *   generation worker pool (the extra ring provides neighbour data for
 *   meshing and lighting).
 * - Results are integrated under a per-frame time budget to avoid hitches.
 * - Chunks beyond `renderDistance + 2` are unloaded: modified chunks are
 *   saved, block data goes to an LRU cache so revisits skip terrain
 *   generation, and evicted buffers return to a pool for reuse.
 */
export class ChunkStreamer {
  /**
   * @param {import('./World.js').World} world
   * @param {import('../workers/WorkerPool.js').WorkerPool} pool generation workers
   * @param {object} [options]
   * @param {object|null} [options.storage] world storage (see save/WorldStorage)
   * @param {number} [options.renderDistance=8]
   * @param {number} [options.cacheSize=128] unloaded chunks kept in memory
   */
  constructor(world, pool, { storage = null, renderDistance = 8, cacheSize = 128 } = {}) {
    this.world = world;
    this.pool = pool;
    this.storage = storage;
    this.renderDistance = renderDistance;
    this.centerX = NaN;
    this.centerZ = NaN;
    /** Wanted chunk coordinates sorted by distance. @type {{cx:number, cz:number, key:number}[]} */
    this.wanted = [];
    this.wantedKeys = new Set();
    this.pending = new Set();
    this.cursor = 0;
    /** Worker results waiting to be integrated. */
    this.ready = [];
    this.buffers = new ObjectPool(() => new Uint8Array(CHUNK_VOLUME), null, 64);
    this.cache = new LRUCache(cacheSize, (_key, entry) => this.buffers.release(entry.blocks));
    this.disposed = false;
    this.stats = { generated: 0, fromCache: 0, unloaded: 0 };
  }

  /** Chunk radius that is kept loaded. */
  get loadRadius() {
    return this.renderDistance + 1;
  }

  /**
   * Changes the render distance; takes effect on the next update.
   * @param {number} r
   */
  setRenderDistance(r) {
    if (r === this.renderDistance) return;
    this.renderDistance = r;
    this.centerX = NaN;
  }

  /**
   * Number of chunk requests still outstanding.
   * @returns {number}
   */
  get pendingCount() {
    return this.pending.size + this.ready.length;
  }

  /**
   * Streams around world position (x, z). Call once per frame.
   * @param {number} x
   * @param {number} z
   * @param {number} [budgetMs=4] main-thread integration budget
   */
  update(x, z, budgetMs = 4) {
    const cx = Math.floor(x) >> 4;
    const cz = Math.floor(z) >> 4;
    if (cx !== this.centerX || cz !== this.centerZ) {
      this.centerX = cx;
      this.centerZ = cz;
      this.rebuildWanted();
      this.unloadFar();
    }
    this.integrate(budgetMs);
    this.requestMore();
  }

  /** @private */
  rebuildWanted() {
    const r = this.loadRadius;
    const list = [];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > r * r + r) continue;
        list.push({ cx: this.centerX + dx, cz: this.centerZ + dz, key: chunkKey(this.centerX + dx, this.centerZ + dz), d2 });
      }
    }
    list.sort((a, b) => a.d2 - b.d2);
    this.wanted = list;
    this.wantedKeys = new Set(list.map((c) => c.key));
    this.cursor = 0;
  }

  /** @private */
  unloadFar() {
    const limit = this.loadRadius + 1;
    const limit2 = limit * limit + limit;
    const toUnload = [];
    for (const chunk of this.world.chunks.values()) {
      const dx = chunk.cx - this.centerX;
      const dz = chunk.cz - this.centerZ;
      if (dx * dx + dz * dz > limit2) toUnload.push(chunk);
    }
    for (const chunk of toUnload) this.unload(chunk);
  }

  /**
   * Unloads a chunk, saving and caching its data.
   * @param {Chunk} chunk
   */
  unload(chunk) {
    const key = chunkKey(chunk.cx, chunk.cz);
    this.world.removeChunk(chunk.cx, chunk.cz);
    if (chunk.dirty && this.storage) {
      this.storage.saveChunk(chunk);
      chunk.dirty = false;
    }
    this.buffers.release(chunk.light);
    this.cache.set(key, {
      blocks: chunk.blocks,
      biomes: chunk.biomes,
      climate: chunk.climate,
      modifications: chunk.modifications,
      blockEntities: chunk.blockEntities,
      entityData: chunk.entityData,
      hadEntities: chunk.hadEntities,
    });
    this.stats.unloaded++;
  }

  /** @private */
  requestMore() {
    const list = this.wanted;
    while (this.cursor < list.length && this.pool.hasCapacity()) {
      const c = list[this.cursor];
      if (this.world.getChunk(c.cx, c.cz) || this.pending.has(c.key)) {
        this.cursor++;
        continue;
      }
      this.request(c.cx, c.cz, c.key);
      this.cursor++;
    }
    // Chunks can be skipped while their neighbours load; re-scan occasionally.
    if (this.cursor >= list.length && this.world.chunks.size + this.pending.size < list.length) this.cursor = 0;
  }

  /** @private */
  request(cx, cz, key) {
    this.pending.add(key);
    const cached = this.cache.take(key);
    if (cached) {
      const light = this.buffers.acquire();
      this.pool.submit({ type: 'relight', cx, cz, blocks: cached.blocks, light }, [cached.blocks.buffer, light.buffer], (data) => {
        this.ready.push({ data, cached });
      });
      return;
    }
    if (this.storage && this.storage.hasChunk(cx, cz)) {
      this.storage
        .loadChunk(cx, cz)
        .then((saved) => this.submitGenerate(cx, cz, saved))
        .catch((err) => {
          console.error('Failed to load chunk', cx, cz, err);
          this.submitGenerate(cx, cz, null);
        });
      return;
    }
    this.submitGenerate(cx, cz, null);
  }

  /** @private */
  submitGenerate(cx, cz, saved) {
    if (this.disposed) return;
    const blocks = this.buffers.acquire();
    const light = this.buffers.acquire();
    const mods = saved ? saved.mods : null;
    const transfer = [blocks.buffer, light.buffer];
    const modsCopy = mods ? mods.slice() : null;
    if (modsCopy) transfer.push(modsCopy.buffer);
    this.pool.submit({ type: 'generate', cx, cz, blocks, light, mods: modsCopy }, transfer, (data) => {
      this.ready.push({ data, saved });
    });
  }

  /**
   * Converts worker results into world chunks within a time budget.
   * @private
   * @param {number} budgetMs
   */
  integrate(budgetMs) {
    const start = performance.now();
    // Nearest first so the area around the player fills in quickly.
    if (this.ready.length > 1) {
      const cx = this.centerX;
      const cz = this.centerZ;
      this.ready.sort((a, b) => {
        const da = (a.data.cx - cx) ** 2 + (a.data.cz - cz) ** 2;
        const db = (b.data.cx - cx) ** 2 + (b.data.cz - cz) ** 2;
        return da - db;
      });
    }
    let i = 0;
    for (; i < this.ready.length; i++) {
      if (i > 0 && performance.now() - start > budgetMs) break;
      this.integrateOne(this.ready[i]);
    }
    this.ready.splice(0, i);
  }

  /** @private */
  integrateOne({ data, cached, saved }) {
    const key = chunkKey(data.cx, data.cz);
    this.pending.delete(key);
    if (this.disposed || !this.wantedKeys.has(key) || this.world.getChunk(data.cx, data.cz)) {
      this.buffers.release(data.blocks);
      this.buffers.release(data.light);
      return;
    }
    let chunk;
    if (cached) {
      chunk = new Chunk(data.cx, data.cz, {
        blocks: data.blocks,
        light: data.light,
        heightmap: data.heightmap,
        biomes: cached.biomes,
        climate: cached.climate,
      });
      chunk.modifications = cached.modifications;
      chunk.blockEntities = cached.blockEntities;
      chunk.entityData = cached.entityData;
      chunk.hadEntities = cached.hadEntities;
      this.stats.fromCache++;
    } else {
      chunk = new Chunk(data.cx, data.cz, data);
      if (saved) {
        const mods = saved.mods;
        for (let i = 0; i < mods.length; i++) chunk.modifications.set(mods[i] >>> 8, mods[i] & 255);
        if (saved.blockEntities) {
          for (const be of saved.blockEntities) chunk.blockEntities.set(be.index, be.data);
        }
        if (saved.entities && saved.entities.length) {
          chunk.entityData = saved.entities;
          chunk.hadEntities = true;
        }
      }
      this.stats.generated++;
    }
    this.world.addChunk(chunk);
  }

  /**
   * Saves every dirty loaded chunk.
   * @returns {Promise<void>}
   */
  async saveAll() {
    if (!this.storage) return;
    const jobs = [];
    for (const chunk of this.world.chunks.values()) {
      if (chunk.dirty) {
        jobs.push(this.storage.saveChunk(chunk));
        chunk.dirty = false;
      }
    }
    await Promise.all(jobs);
  }

  /** Stops streaming and drops cached data. */
  dispose() {
    this.disposed = true;
    this.ready.length = 0;
    this.cache.clear();
    this.buffers.clear();
  }
}

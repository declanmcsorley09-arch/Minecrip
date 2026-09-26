import { worldChunkRange } from './Database.js';
import { chunkKey } from '../utils/coords.js';
import { FurnaceState } from '../crafting/Furnace.js';

/**
 * Persistence of one world: metadata and per-chunk modification lists.
 *
 * Only player changes are stored (packed as `index << 8 | blockId` in a
 * Uint32Array); unmodified terrain is regenerated from the seed, which keeps
 * saves tiny and deterministic.
 */
export class WorldStorage {
  /**
   * @param {import('./Database.js').Database} db
   * @param {string} worldId
   */
  constructor(db, worldId) {
    this.db = db;
    this.worldId = worldId;
    /** Keys of chunks that have saved data. */
    this.savedChunks = new Set();
    this.pendingWrites = new Set();
  }

  /** Loads the index of saved chunks. */
  async init() {
    const keys = await this.db.getAllKeys('chunks', worldChunkRange(this.worldId));
    for (const k of keys) this.savedChunks.add(chunkKey(k[1], k[2]));
  }

  /**
   * @param {number} cx
   * @param {number} cz
   * @returns {boolean}
   */
  hasChunk(cx, cz) {
    return this.savedChunks.has(chunkKey(cx, cz));
  }

  /**
   * Loads saved modifications of a chunk.
   * @param {number} cx
   * @param {number} cz
   * @returns {Promise<{mods: Uint32Array, blockEntities: {index:number, data:object}[]}|null>}
   */
  async loadChunk(cx, cz) {
    const rec = await this.db.get('chunks', [this.worldId, cx, cz]);
    if (!rec) return null;
    const mods = rec.mods instanceof Uint32Array ? rec.mods : new Uint32Array(rec.mods ?? []);
    const blockEntities = (rec.blockEntities ?? []).map((be) => ({ index: be.index, data: reviveBlockEntity(be.data) })).filter((be) => be.data);
    return { mods, blockEntities };
  }

  /**
   * Snapshots and writes a chunk's modifications.
   * @param {import('../world/Chunk.js').Chunk} chunk
   * @returns {Promise<void>}
   */
  saveChunk(chunk) {
    const mods = new Uint32Array(chunk.modifications.size);
    let i = 0;
    for (const [idx, id] of chunk.modifications) mods[i++] = ((idx << 8) | id) >>> 0;
    const blockEntities = [];
    for (const [index, be] of chunk.blockEntities) {
      if (be && typeof be.toJSON === 'function') blockEntities.push({ index, data: be.toJSON() });
    }
    this.savedChunks.add(chunkKey(chunk.cx, chunk.cz));
    const p = this.db
      .put('chunks', { worldId: this.worldId, cx: chunk.cx, cz: chunk.cz, mods, blockEntities })
      .catch((e) => console.error('Chunk save failed', e))
      .finally(() => this.pendingWrites.delete(p));
    this.pendingWrites.add(p);
    return p;
  }

  /**
   * Merges and stores world metadata.
   * @param {object} meta
   * @returns {Promise<void>}
   */
  async saveMeta(meta) {
    const existing = (await this.db.get('worlds', this.worldId)) ?? { id: this.worldId };
    await this.db.put('worlds', { ...existing, ...meta, id: this.worldId, lastPlayed: Date.now() });
  }

  /**
   * Resolves when every in-flight chunk write has completed.
   * @returns {Promise<void>}
   */
  async flush() {
    await Promise.all([...this.pendingWrites]);
  }
}

/**
 * Recreates a block entity instance from saved JSON.
 * @param {object} data
 * @returns {object|null}
 */
export function reviveBlockEntity(data) {
  if (!data) return null;
  if (data.type === 'furnace') return FurnaceState.fromJSON(data);
  return null;
}

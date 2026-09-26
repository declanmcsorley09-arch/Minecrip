import {
  CHUNK_SIZE,
  CHUNK_HEIGHT,
  CHUNK_VOLUME,
  LAYER_AREA,
  SECTIONS_PER_CHUNK,
  SECTION_SIZE,
} from './constants.js';

/**
 * Storage for one 16×256×16 column of the world.
 *
 * Block ids are stored as bytes indexed `x | z<<4 | y<<8`. Light is packed
 * per block with sky light in the high nibble and block light in the low
 * nibble. Player modifications are tracked separately so that saves only
 * need to store the difference from freshly generated terrain.
 */
export class Chunk {
  /**
   * @param {number} cx chunk x
   * @param {number} cz chunk z
   * @param {object} [data] pre-allocated arrays (from generation or a pool)
   * @param {Uint8Array} [data.blocks]
   * @param {Uint8Array} [data.light]
   * @param {Uint8Array} [data.heightmap]
   * @param {Uint8Array} [data.biomes]
   * @param {Uint8Array} [data.climate]
   */
  constructor(cx, cz, data = {}) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = data.blocks ?? new Uint8Array(CHUNK_VOLUME);
    this.light = data.light ?? new Uint8Array(CHUNK_VOLUME);
    /** Y of the first air block above the highest non-air block, per column. */
    this.heightmap = data.heightmap ?? new Uint8Array(LAYER_AREA);
    this.biomes = data.biomes ?? new Uint8Array(LAYER_AREA);
    /** Packed climate byte per column (see BiomeColors.packClimate). */
    this.climate = data.climate ?? new Uint8Array(LAYER_AREA);
    /** Non-air block count per 16³ section (for skipping empty sections). */
    this.sectionCounts = new Uint16Array(SECTIONS_PER_CHUNK);
    /** Player/world edits: block index → block id. */
    this.modifications = new Map();
    /** Block entities (furnaces...) keyed by block index. @type {Map<number, object>} */
    this.blockEntities = new Map();
    /** True when there are unsaved modifications. */
    this.dirty = false;
    /** Serialised entities awaiting spawn (after load) or saving (on unload). @type {object[]|null} */
    this.entityData = null;
    /** Whether the saved record currently contains entities. */
    this.hadEntities = false;
    /** Increments on every block change (used to discard stale meshes). */
    this.version = 0;
    this.recountSections();
  }

  /**
   * Recomputes {@link Chunk#sectionCounts} from the block array.
   */
  recountSections() {
    const blocks = this.blocks;
    const per = SECTION_SIZE * LAYER_AREA;
    for (let s = 0; s < SECTIONS_PER_CHUNK; s++) {
      let count = 0;
      const start = s * per;
      const end = start + per;
      for (let i = start; i < end; i++) if (blocks[i] !== 0) count++;
      this.sectionCounts[s] = count;
    }
  }

  /**
   * Recomputes the heightmap from the block array.
   */
  recomputeHeightmap() {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) this.updateHeightColumn(x, z);
    }
  }

  /**
   * Recomputes one heightmap column.
   * @param {number} x local x
   * @param {number} z local z
   */
  updateHeightColumn(x, z) {
    const col = x | (z << 4);
    let y = CHUNK_HEIGHT - 1;
    while (y >= 0 && this.blocks[col | (y << 8)] === 0) y--;
    this.heightmap[col] = y + 1 > 255 ? 255 : y + 1;
  }

  /**
   * @param {number} x local x 0..15
   * @param {number} y 0..255
   * @param {number} z local z 0..15
   * @returns {number} block id
   */
  getBlock(x, y, z) {
    if (y < 0 || y >= CHUNK_HEIGHT) return 0;
    return this.blocks[x | (z << 4) | (y << 8)];
  }

  /**
   * Low level block write that keeps section counts and heightmap in sync.
   * Does not touch lighting (see World#setBlock).
   * @param {number} x local x
   * @param {number} y
   * @param {number} z local z
   * @param {number} id
   * @param {boolean} [track=true] record as a player modification for saving
   * @returns {number} previous block id
   */
  setBlock(x, y, z, id, track = true) {
    const idx = x | (z << 4) | (y << 8);
    const prev = this.blocks[idx];
    if (prev === id) return prev;
    this.blocks[idx] = id;
    const s = y >> 4;
    if (prev === 0) this.sectionCounts[s]++;
    else if (id === 0) this.sectionCounts[s]--;
    const col = x | (z << 4);
    const h = this.heightmap[col];
    if (id !== 0 && y + 1 > h) this.heightmap[col] = y + 1;
    else if (id === 0 && y + 1 === h) this.updateHeightColumn(x, z);
    if (track) {
      this.modifications.set(idx, id);
      this.dirty = true;
    }
    this.version++;
    return prev;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {number} sky light 0..15
   */
  getSkyLight(x, y, z) {
    if (y >= CHUNK_HEIGHT) return 15;
    if (y < 0) return 0;
    return this.light[x | (z << 4) | (y << 8)] >> 4;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {number} block light 0..15
   */
  getBlockLight(x, y, z) {
    if (y < 0 || y >= CHUNK_HEIGHT) return 0;
    return this.light[x | (z << 4) | (y << 8)] & 15;
  }

  /**
   * Applies saved modifications on top of freshly generated terrain.
   * @param {Map<number, number>|Iterable<[number, number]>} mods
   */
  applyModifications(mods) {
    for (const [idx, id] of mods) {
      this.blocks[idx] = id;
      this.modifications.set(idx, id);
    }
    this.recountSections();
    this.recomputeHeightmap();
  }

  /**
   * Whether section `sy` contains no blocks.
   * @param {number} sy
   * @returns {boolean}
   */
  isSectionEmpty(sy) {
    return this.sectionCounts[sy] === 0;
  }
}

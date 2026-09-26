/**
 * Server-side collection of entities with a uniform-grid spatial hash for
 * fast proximity queries (item merging, pickups, mob targeting, spawn caps).
 */

const CELL = 8;

export class EntityManager {
  constructor() {
    /** @type {Map<number, import('./Entity.js').Entity>} */
    this.entities = new Map();
    /** @type {Map<number, import('./Entity.js').Entity[]>} */
    this.grid = new Map();
    /** Ids removed since the last {@link EntityManager#drainRemoved}. */
    this.removedIds = [];
  }

  /** @returns {number} */
  get size() {
    return this.entities.size;
  }

  /**
   * Adds an entity.
   * @param {import('./Entity.js').Entity} entity
   * @returns {import('./Entity.js').Entity}
   */
  add(entity) {
    this.entities.set(entity.id, entity);
    this.insertIntoGrid(entity);
    return entity;
  }

  /**
   * @param {number} id
   * @returns {import('./Entity.js').Entity|undefined}
   */
  get(id) {
    return this.entities.get(id);
  }

  /** @private */
  cellKey(x, y, z) {
    return ((Math.floor(x / CELL) + 32768) * 65536 + (Math.floor(z / CELL) + 32768)) * 64 + (Math.floor(y / CELL) & 63);
  }

  /** @private */
  insertIntoGrid(e) {
    const key = this.cellKey(e.x, e.y, e.z);
    let list = this.grid.get(key);
    if (!list) {
      list = [];
      this.grid.set(key, list);
    }
    list.push(e);
  }

  /** Rebuilds the spatial hash (called once per tick after movement). */
  rebuildGrid() {
    this.grid.clear();
    for (const e of this.entities.values()) if (!e.removed) this.insertIntoGrid(e);
  }

  /**
   * Entities within radius r of a point.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} r
   * @returns {import('./Entity.js').Entity[]}
   */
  query(x, y, z, r) {
    const out = [];
    const r2 = r * r;
    const x0 = Math.floor((x - r) / CELL);
    const x1 = Math.floor((x + r) / CELL);
    const y0 = Math.floor((y - r) / CELL);
    const y1 = Math.floor((y + r) / CELL);
    const z0 = Math.floor((z - r) / CELL);
    const z1 = Math.floor((z + r) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        for (let cy = y0; cy <= y1; cy++) {
          const list = this.grid.get(((cx + 32768) * 65536 + (cz + 32768)) * 64 + (cy & 63));
          if (!list) continue;
          for (const e of list) if (!e.removed && e.distanceSq(x, y, z) <= r2) out.push(e);
        }
      }
    }
    return out;
  }

  /**
   * Counts living mobs of a category within a radius.
   * @param {string} category
   * @param {number} x
   * @param {number} z
   * @param {number} r
   * @returns {number}
   */
  countCategory(category, x, z, r) {
    let n = 0;
    for (const e of this.entities.values()) {
      if (e.category !== category || e.removed) continue;
      const dx = e.x - x;
      const dz = e.z - z;
      if (dx * dx + dz * dz <= r * r) n++;
    }
    return n;
  }

  /**
   * Ticks every entity, removing those flagged as removed.
   * @param {number} dt
   * @param {import('./Entity.js').EntityContext} ctx
   */
  tick(dt, ctx) {
    for (const e of this.entities.values()) {
      if (e.removed) continue;
      // Freeze entities whose chunk is not loaded.
      if (!ctx.world.isLoaded(e.x, e.z)) {
        if (e.canDespawn() || e.type === 'item' || e.type === 'arrow') e.remove();
        continue;
      }
      e.tick(dt, ctx);
    }
    for (const [id, e] of this.entities) {
      if (e.removed) {
        this.entities.delete(id);
        this.removedIds.push(id);
      }
    }
    this.rebuildGrid();
  }

  /**
   * Returns and clears the list of removed entity ids.
   * @returns {number[]}
   */
  drainRemoved() {
    const ids = this.removedIds;
    this.removedIds = [];
    return ids;
  }

  /** Removes every entity. */
  clear() {
    for (const id of this.entities.keys()) this.removedIds.push(id);
    this.entities.clear();
    this.grid.clear();
  }
}

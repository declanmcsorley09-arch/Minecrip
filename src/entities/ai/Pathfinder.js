import { blockRegistry, BlockIds } from '../../blocks/index.js';
import { MinHeap } from '../../utils/MinHeap.js';

/**
 * A* pathfinding over the voxel grid for walking mobs.
 *
 * Nodes are the feet cells a mob can stand in: the cells from the feet up
 * to its height are free of colliding blocks and the block below supports
 * it (or the cell is water, which is allowed but costly). Moves: 8-way
 * walking without corner cutting, stepping up one block, and dropping down
 * a few blocks. When the goal is unreachable within the node budget the
 * path to the closest explored node is returned, so chasing mobs still make
 * progress.
 */

const DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * @typedef {object} PathOptions
 * @property {number} [height=2] mob height in whole blocks
 * @property {number} [maxFall=3] highest safe drop
 * @property {number} [maxNodes=700] search budget
 * @property {number} [maxRange=40] maximum horizontal distance explored
 */

export class Pathfinder {
  /**
   * @param {{getBlock:(x:number,y:number,z:number)=>number}} world
   */
  constructor(world) {
    this.world = world;
    this.open = new MinHeap();
  }

  /** Whether a mob body can occupy the cell (collision-free). @private */
  passable(x, y, z) {
    const id = this.world.getBlock(x, y, z);
    if (id === 0) return true;
    if (id === BlockIds.cactus) return false;
    return !blockRegistry.byId[id].collision;
  }

  /** @private */
  isWater(x, y, z) {
    return blockRegistry.fluid[this.world.getBlock(x, y, z)] === 1;
  }

  /**
   * Cost multiplier of standing at a node, or 0 if impossible.
   * @private
   */
  standCost(x, y, z, height) {
    if (y < 1 || y > 254) return 0;
    for (let i = 0; i < height; i++) if (!this.passable(x, y + i, z)) return 0;
    const below = this.world.getBlock(x, y - 1, z);
    if (this.isWater(x, y, z)) return 4;
    if (below === BlockIds.cactus) return 0;
    const def = blockRegistry.byId[below];
    if (!def || !def.collision) return 0;
    if (this.isWater(x, y - 1, z)) return 4;
    return 1;
  }

  /**
   * Finds a path between two feet cells.
   * @param {number} sx
   * @param {number} sy
   * @param {number} sz
   * @param {number} tx
   * @param {number} ty
   * @param {number} tz
   * @param {PathOptions} [opts]
   * @returns {{x:number,y:number,z:number}[]|null} nodes excluding the start
   */
  findPath(sx, sy, sz, tx, ty, tz, opts = {}) {
    const height = opts.height ?? 2;
    const maxFall = opts.maxFall ?? 3;
    const maxNodes = opts.maxNodes ?? 700;
    const maxRange = opts.maxRange ?? 40;
    const key = (x, y, z) => ((x - sx + 1024) * 2048 + (z - sz + 1024)) * 256 + y;
    const h = (x, y, z) => {
      const dx = Math.abs(x - tx);
      const dz = Math.abs(z - tz);
      return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz) + Math.abs(y - ty) * 0.5;
    };
    const open = this.open;
    open.clear();
    const g = new Map();
    const parent = new Map();
    const pos = new Map();
    const startKey = key(sx, sy, sz);
    g.set(startKey, 0);
    pos.set(startKey, [sx, sy, sz]);
    open.push(startKey, h(sx, sy, sz));
    let bestKey = startKey;
    let bestH = h(sx, sy, sz);
    let expanded = 0;
    const closed = new Set();

    while (open.size > 0 && expanded < maxNodes) {
      const cur = open.pop();
      if (closed.has(cur)) continue;
      closed.add(cur);
      expanded++;
      const [x, y, z] = pos.get(cur);
      const hc = h(x, y, z);
      if (hc < bestH) {
        bestH = hc;
        bestKey = cur;
      }
      if (x === tx && z === tz && Math.abs(y - ty) <= 1) {
        bestKey = cur;
        break;
      }
      const gc = g.get(cur);
      for (const [dx, dz, stepCost] of DIRS) {
        const nx = x + dx;
        const nz = z + dz;
        if (Math.abs(nx - sx) > maxRange || Math.abs(nz - sz) > maxRange) continue;
        if (dx !== 0 && dz !== 0) {
          // No corner cutting: both orthogonal neighbours must be free.
          let ok = true;
          for (let i = 0; i < height && ok; i++) ok = this.passable(x + dx, y + i, z) && this.passable(x, y + i, z + dz);
          if (!ok) continue;
        }
        let ny = y;
        let cost = this.standCost(nx, y, nz, height);
        let extra = 0;
        if (!cost) {
          // Step up (needs headroom above the current cell).
          if (this.standCost(nx, y + 1, nz, height) && this.passable(x, y + height, z)) {
            ny = y + 1;
            cost = this.standCost(nx, ny, nz, height);
            extra = 0.6;
          } else if (this.passable(nx, y, nz) && this.passable(nx, y + height - 1, nz)) {
            // Drop down.
            for (let d = 1; d <= maxFall; d++) {
              if (!this.passable(nx, y - d, nz)) break;
              const c = this.standCost(nx, y - d, nz, height);
              if (c) {
                ny = y - d;
                cost = c;
                extra = d * 0.4;
                break;
              }
            }
          }
        }
        if (!cost) continue;
        const nk = key(nx, ny, nz);
        if (closed.has(nk)) continue;
        const ng = gc + stepCost * cost + extra;
        const old = g.get(nk);
        if (old !== undefined && old <= ng) continue;
        g.set(nk, ng);
        parent.set(nk, cur);
        pos.set(nk, [nx, ny, nz]);
        open.push(nk, ng + h(nx, ny, nz));
      }
    }

    if (bestKey === startKey) return null;
    const path = [];
    let k = bestKey;
    while (k !== startKey) {
      const [x, y, z] = pos.get(k);
      path.push({ x, y, z });
      k = parent.get(k);
    }
    path.reverse();
    return path;
  }
}

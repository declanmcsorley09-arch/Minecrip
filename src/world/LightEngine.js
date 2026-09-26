import { blockRegistry } from '../blocks/index.js';
import { IntQueue } from '../utils/IntQueue.js';
import { CHUNK_HEIGHT, MAX_LIGHT } from './constants.js';

/**
 * Incremental flood-fill lighting across loaded chunks.
 *
 * Implements the classic two-queue algorithm: removals first zero out every
 * cell that depended on the changed light, then additions re-propagate from
 * the surviving boundary. Sky light keeps full strength while travelling
 * straight down through transparent blocks. Every changed cell marks its
 * render sections dirty through the owning world, so only affected sections
 * are rebuilt.
 */

// Direction vectors in face order: +X, -X, +Y, -Y, +Z, -Z.
const DX = [1, -1, 0, 0, 0, 0];
const DY = [0, 0, 1, -1, 0, 0];
const DZ = [0, 0, 0, 0, 1, -1];
const DOWN = 3;

export class LightEngine {
  /**
   * @param {import('./World.js').World} world
   */
  constructor(world) {
    this.world = world;
    this.addSky = new IntQueue(3, 8192);
    this.addBlock = new IntQueue(3, 8192);
    this.removeSky = new IntQueue(4, 8192);
    this.removeBlock = new IntQueue(4, 8192);
    this.tmp = new Int32Array(4);
    /** Single-entry chunk lookup cache. */
    this.cacheKeyX = NaN;
    this.cacheKeyZ = NaN;
    this.cacheChunk = null;
  }

  /**
   * Cached chunk lookup by world block coordinates.
   * @private
   * @param {number} x
   * @param {number} z
   * @returns {import('./Chunk.js').Chunk|undefined}
   */
  chunk(x, z) {
    const cx = x >> 4;
    const cz = z >> 4;
    if (cx === this.cacheKeyX && cz === this.cacheKeyZ) return this.cacheChunk;
    this.cacheKeyX = cx;
    this.cacheKeyZ = cz;
    this.cacheChunk = this.world.getChunk(cx, cz);
    return this.cacheChunk;
  }

  /** Invalidates the lookup cache (call when chunks are added/removed). */
  resetCache() {
    this.cacheKeyX = NaN;
    this.cacheKeyZ = NaN;
    this.cacheChunk = null;
  }

  /**
   * Updates lighting after a block change at (x, y, z).
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} oldId
   * @param {number} newId
   */
  onBlockChanged(x, y, z, oldId, newId) {
    const reg = blockRegistry;
    const c = this.chunk(x, z);
    if (!c) return;
    const idx = (x & 15) | ((z & 15) << 4) | (y << 8);
    const opacityChanged = reg.opaque[oldId] !== reg.opaque[newId] || reg.filter[oldId] !== reg.filter[newId];

    if (opacityChanged || reg.emission[oldId] !== reg.emission[newId]) {
      const old = c.light[idx] & 15;
      if (old > 0) {
        c.light[idx] &= 0xf0;
        this.removeBlock.push(x, y, z, old);
        this.runBlockRemoval();
      }
      const e = reg.emission[newId];
      if (e > 0) {
        c.light[idx] = (c.light[idx] & 0xf0) | e;
        this.addBlock.push(x, y, z);
      }
      if (!reg.opaque[newId]) this.seedNeighbors(x, y, z, false);
      this.world.markBlockDirty(x, y, z);
      this.propagateBlock();
    }

    if (opacityChanged) {
      const old = c.light[idx] >> 4;
      if (old > 0) {
        c.light[idx] &= 0x0f;
        this.removeSky.push(x, y, z, old);
        this.runSkyRemoval();
      }
      if (!reg.opaque[newId]) {
        if (y === CHUNK_HEIGHT - 1) {
          const f = reg.filter[newId];
          const top = f === 0 ? MAX_LIGHT : MAX_LIGHT - 1 - f;
          c.light[idx] = (c.light[idx] & 15) | (top << 4);
          this.addSky.push(x, y, z);
        }
        this.seedNeighbors(x, y, z, true);
      }
      this.world.markBlockDirty(x, y, z);
      this.propagateSky();
    }
  }

  /**
   * Pushes every lit neighbour of a cell onto the add queue.
   * @private
   */
  seedNeighbors(x, y, z, sky) {
    for (let d = 0; d < 6; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      const nz = z + DZ[d];
      if (ny < 0 || ny >= CHUNK_HEIGHT) continue;
      const nc = this.chunk(nx, nz);
      if (!nc) continue;
      const v = nc.light[(nx & 15) | ((nz & 15) << 4) | (ny << 8)];
      if (sky ? v >> 4 : v & 15) (sky ? this.addSky : this.addBlock).push(nx, ny, nz);
    }
  }

  /**
   * Stitches the lighting of a freshly added chunk with its loaded
   * neighbours, propagating light across the shared borders.
   * @param {import('./Chunk.js').Chunk} chunk
   */
  mergeChunk(chunk) {
    this.resetCache();
    const opaque = blockRegistry.opaque;
    const neighbors = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    let maxH = 0;
    for (let i = 0; i < 256; i++) if (chunk.heightmap[i] > maxH) maxH = chunk.heightmap[i];
    const baseX = chunk.cx << 4;
    const baseZ = chunk.cz << 4;
    for (const [dx, dz] of neighbors) {
      const nb = this.world.getChunk(chunk.cx + dx, chunk.cz + dz);
      if (!nb) continue;
      let top = maxH;
      for (let i = 0; i < 256; i++) if (nb.heightmap[i] > top) top = nb.heightmap[i];
      top = Math.min(top + 1, CHUNK_HEIGHT - 1);
      for (let i = 0; i < 16; i++) {
        // Local coordinates of the border cell in chunk (a) and neighbour (b).
        let ax, az, bx, bz;
        if (dx === 1) {
          ax = 15; az = i; bx = 0; bz = i;
        } else if (dx === -1) {
          ax = 0; az = i; bx = 15; bz = i;
        } else if (dz === 1) {
          ax = i; az = 15; bx = i; bz = 0;
        } else {
          ax = i; az = 0; bx = i; bz = 15;
        }
        // Above `top` both sides have full sky light, but block light (e.g.
        // from a torch on a tall pillar) can still differ, so scan all y.
        for (let y = 0; y < CHUNK_HEIGHT; y++) {
          const ai = ax | (az << 4) | (y << 8);
          const bi = bx | (bz << 4) | (y << 8);
          const la = chunk.light[ai];
          const lb = nb.light[bi];
          if (y > top && ((la | lb) & 15) === 0) continue;
          const aOpaque = opaque[chunk.blocks[ai]];
          const bOpaque = opaque[nb.blocks[bi]];
          if (!bOpaque) {
            if (la >> 4 > (lb >> 4) + 1) this.addSky.push(baseX + ax, y, baseZ + az);
            if ((la & 15) > (lb & 15) + 1) this.addBlock.push(baseX + ax, y, baseZ + az);
          }
          if (!aOpaque) {
            const nbx = ((chunk.cx + dx) << 4) + bx;
            const nbz = ((chunk.cz + dz) << 4) + bz;
            if (lb >> 4 > (la >> 4) + 1) this.addSky.push(nbx, y, nbz);
            if ((lb & 15) > (la & 15) + 1) this.addBlock.push(nbx, y, nbz);
          }
        }
      }
    }
    this.propagateSky();
    this.propagateBlock();
  }

  /** @private */
  runSkyRemoval() {
    const q = this.removeSky;
    const t = this.tmp;
    while (q.pop(t)) {
      const x = t[0];
      const y = t[1];
      const z = t[2];
      const level = t[3];
      for (let d = 0; d < 6; d++) {
        const ny = y + DY[d];
        if (ny < 0 || ny >= CHUNK_HEIGHT) continue;
        const nx = x + DX[d];
        const nz = z + DZ[d];
        const nc = this.chunk(nx, nz);
        if (!nc) continue;
        const ni = (nx & 15) | ((nz & 15) << 4) | (ny << 8);
        const nl = nc.light[ni] >> 4;
        if (nl === 0) continue;
        if (nl < level || (d === DOWN && level === MAX_LIGHT && nl === MAX_LIGHT)) {
          nc.light[ni] &= 0x0f;
          this.world.markBlockDirty(nx, ny, nz);
          q.push(nx, ny, nz, nl);
        } else {
          this.addSky.push(nx, ny, nz);
        }
      }
    }
  }

  /** @private */
  runBlockRemoval() {
    const q = this.removeBlock;
    const t = this.tmp;
    const emission = blockRegistry.emission;
    while (q.pop(t)) {
      const x = t[0];
      const y = t[1];
      const z = t[2];
      const level = t[3];
      for (let d = 0; d < 6; d++) {
        const ny = y + DY[d];
        if (ny < 0 || ny >= CHUNK_HEIGHT) continue;
        const nx = x + DX[d];
        const nz = z + DZ[d];
        const nc = this.chunk(nx, nz);
        if (!nc) continue;
        const ni = (nx & 15) | ((nz & 15) << 4) | (ny << 8);
        const nl = nc.light[ni] & 15;
        if (nl === 0) continue;
        if (nl < level) {
          const e = emission[nc.blocks[ni]];
          nc.light[ni] = (nc.light[ni] & 0xf0) | e;
          if (e > 0) this.addBlock.push(nx, ny, nz);
          this.world.markBlockDirty(nx, ny, nz);
          q.push(nx, ny, nz, nl);
        } else {
          this.addBlock.push(nx, ny, nz);
        }
      }
    }
  }

  /**
   * Flood-fills sky light from every queued cell.
   */
  propagateSky() {
    const q = this.addSky;
    const t = this.tmp;
    const opaque = blockRegistry.opaque;
    const filter = blockRegistry.filter;
    while (q.pop(t)) {
      const x = t[0];
      const y = t[1];
      const z = t[2];
      const c = this.chunk(x, z);
      if (!c) continue;
      const level = c.light[(x & 15) | ((z & 15) << 4) | (y << 8)] >> 4;
      if (level <= 1) continue;
      for (let d = 0; d < 6; d++) {
        const ny = y + DY[d];
        if (ny < 0 || ny >= CHUNK_HEIGHT) continue;
        const nx = x + DX[d];
        const nz = z + DZ[d];
        const nc = this.chunk(nx, nz);
        if (!nc) continue;
        const ni = (nx & 15) | ((nz & 15) << 4) | (ny << 8);
        const id = nc.blocks[ni];
        if (opaque[id]) continue;
        const f = filter[id];
        const nl = d === DOWN && level === MAX_LIGHT && f === 0 ? MAX_LIGHT : level - 1 - f;
        if (nl <= 0) continue;
        if (nc.light[ni] >> 4 < nl) {
          nc.light[ni] = (nc.light[ni] & 15) | (nl << 4);
          this.world.markBlockDirty(nx, ny, nz);
          q.push(nx, ny, nz);
        }
      }
    }
  }

  /**
   * Flood-fills block light from every queued cell.
   */
  propagateBlock() {
    const q = this.addBlock;
    const t = this.tmp;
    const opaque = blockRegistry.opaque;
    const filter = blockRegistry.filter;
    while (q.pop(t)) {
      const x = t[0];
      const y = t[1];
      const z = t[2];
      const c = this.chunk(x, z);
      if (!c) continue;
      const level = c.light[(x & 15) | ((z & 15) << 4) | (y << 8)] & 15;
      if (level <= 1) continue;
      for (let d = 0; d < 6; d++) {
        const ny = y + DY[d];
        if (ny < 0 || ny >= CHUNK_HEIGHT) continue;
        const nx = x + DX[d];
        const nz = z + DZ[d];
        const nc = this.chunk(nx, nz);
        if (!nc) continue;
        const ni = (nx & 15) | ((nz & 15) << 4) | (ny << 8);
        const id = nc.blocks[ni];
        if (opaque[id]) continue;
        const nl = level - 1 - filter[id];
        if (nl <= 0) continue;
        if ((nc.light[ni] & 15) < nl) {
          nc.light[ni] = (nc.light[ni] & 0xf0) | nl;
          this.world.markBlockDirty(nx, ny, nz);
          q.push(nx, ny, nz);
        }
      }
    }
  }
}

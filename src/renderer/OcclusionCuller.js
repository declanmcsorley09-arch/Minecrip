import { facesConnected } from './ChunkMesher.js';
import { sectionKey } from '../utils/coords.js';
import { SECTIONS_PER_CHUNK } from '../world/constants.js';

/**
 * Cave-culling style occlusion culling.
 *
 * Starting at the camera's section, a breadth-first search walks through
 * neighbouring sections, only crossing from face A to face B of a section
 * when its mesher-computed connectivity graph says A and B are connected by
 * non-opaque blocks, and never turning back toward the camera. Sections the
 * search never reaches are completely hidden behind solid terrain (e.g. cave
 * systems seen from the surface) and are skipped by the renderer.
 */

const DX = [1, -1, 0, 0, 0, 0];
const DY = [0, 0, 1, -1, 0, 0];
const DZ = [0, 0, 0, 0, 1, -1];

export class OcclusionCuller {
  constructor() {
    /** Section keys reached by the last search. @type {Set<number>} */
    this.visible = new Set();
    this.visited = new Set();
    this.capacity = 8192;
    this.qx = new Int32Array(this.capacity);
    this.qy = new Int8Array(this.capacity);
    this.qz = new Int32Array(this.capacity);
    this.qEntry = new Int8Array(this.capacity);
    this.qDirs = new Uint8Array(this.capacity);
  }

  /** @private */
  grow() {
    const cap = this.capacity * 2;
    const grow = (Arr, old) => {
      const a = new Arr(cap);
      a.set(old);
      return a;
    };
    this.qx = grow(Int32Array, this.qx);
    this.qy = grow(Int8Array, this.qy);
    this.qz = grow(Int32Array, this.qz);
    this.qEntry = grow(Int8Array, this.qEntry);
    this.qDirs = grow(Uint8Array, this.qDirs);
    this.capacity = cap;
  }

  /**
   * Runs the visibility search.
   * @param {number} cx camera chunk x
   * @param {number} sy camera section y (clamped to 0..15)
   * @param {number} cz camera chunk z
   * @param {number} radius chunk radius
   * @param {(cx:number, sy:number, cz:number) => number} getVisibility
   *   returns the section's connectivity mask, or -1 if its chunk is not loaded
   * @returns {Set<number>} visible section keys
   */
  compute(cx, sy, cz, radius, getVisibility) {
    const visible = this.visible;
    const visited = this.visited;
    visible.clear();
    visited.clear();
    const r2 = radius * radius + radius;
    let head = 0;
    let tail = 0;
    this.qx[0] = cx;
    this.qy[0] = sy;
    this.qz[0] = cz;
    this.qEntry[0] = -1;
    this.qDirs[0] = 0;
    tail = 1;
    visited.add(sectionKey(cx, sy, cz));
    while (head < tail) {
      const x = this.qx[head];
      const y = this.qy[head];
      const z = this.qz[head];
      const entry = this.qEntry[head];
      const dirs = this.qDirs[head];
      head++;
      visible.add(sectionKey(x, y, z));
      const mask = getVisibility(x, y, z);
      for (let f = 0; f < 6; f++) {
        if (dirs & (1 << (f ^ 1))) continue;
        if (entry >= 0 && !facesConnected(mask, entry, f)) continue;
        const nx = x + DX[f];
        const ny = y + DY[f];
        const nz = z + DZ[f];
        if (ny < 0 || ny >= SECTIONS_PER_CHUNK) continue;
        const ddx = nx - cx;
        const ddz = nz - cz;
        if (ddx * ddx + ddz * ddz > r2) continue;
        const key = sectionKey(nx, ny, nz);
        if (visited.has(key)) continue;
        visited.add(key);
        if (getVisibility(nx, ny, nz) < 0) continue;
        if (tail >= this.capacity) this.grow();
        this.qx[tail] = nx;
        this.qy[tail] = ny;
        this.qz[tail] = nz;
        this.qEntry[tail] = f ^ 1;
        this.qDirs[tail] = dirs | (1 << f);
        tail++;
      }
    }
    return visible;
  }
}

import { SimplexNoise } from '../utils/noise/SimplexNoise.js';
import { FractalNoise } from '../utils/noise/FractalNoise.js';
import { mix32 } from '../utils/random.js';
import { smoothstep } from '../utils/math.js';

/**
 * 3D-noise cave system.
 *
 * Two kinds of caves are combined:
 * - "spaghetti" tunnels where two independent 3D noise fields are both
 *   close to zero (the intersection of two noise iso-surfaces is a tube),
 * - "cheese" caverns where a third fractal field exceeds a threshold deep
 *   underground.
 *
 * The density is sampled on a world-aligned 4×4×4 lattice and trilinearly
 * interpolated, which is ~30× cheaper than per-block noise and — because the
 * lattice is aligned in world space — gives identical results regardless of
 * which chunk asks.
 */

/** Lattice spacing in blocks. */
const STEP = 4;
const NXZ = 16 / STEP + 1;

export class CaveCarver {
  /**
   * @param {number} seed
   */
  constructor(seed) {
    this.tunnelA = new SimplexNoise(mix32(seed ^ 0x51ed270b));
    this.tunnelB = new SimplexNoise(mix32(seed ^ 0x2545f491));
    this.cheese = new FractalNoise(seed, { salt: 20, octaves: 2, frequency: 1 / 70 });
    this.region = new FractalNoise(seed, { salt: 21, octaves: 2, frequency: 1 / 320 });
    this.ny = 0;
    this.grid = new Float32Array(NXZ * NXZ * (256 / STEP + 1));
  }

  /**
   * Raw cave density at a world position. Negative values are carved.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {number}
   */
  rawDensity(x, y, z) {
    if (y <= 4) return 1;
    const region = this.region.sample2D(x, z) * 0.5 + 0.5;
    const width = 0.0035 + 0.0055 * region;
    const n1 = this.tunnelA.noise3D(x / 56, y / 30, z / 56);
    const n2 = this.tunnelB.noise3D(x / 56 + 311.3, y / 30, z / 56 - 173.9);
    const spaghetti = (n1 * n1 + n2 * n2 - width) * 30;
    const depth = smoothstep(56, 20, y);
    if (depth <= 0) return spaghetti;
    const cheese = 0.6 - this.cheese.sample3D(x, y * 1.8, z) * 1.7 + (1 - depth) * 1.5;
    return Math.min(spaghetti, cheese);
  }

  /**
   * Fills the density lattice for a chunk up to `maxY`.
   * @param {number} cx
   * @param {number} cz
   * @param {number} maxY highest y that may be carved
   */
  prepare(cx, cz, maxY) {
    this.ny = Math.min(256 / STEP, Math.ceil((maxY + 1) / STEP)) + 1;
    const ox = cx * 16;
    const oz = cz * 16;
    const ny = this.ny;
    for (let i = 0; i < NXZ; i++) {
      for (let k = 0; k < NXZ; k++) {
        const base = (i * NXZ + k) * ny;
        for (let j = 0; j < ny; j++) {
          this.grid[base + j] = this.rawDensity(ox + i * STEP, j * STEP, oz + k * STEP);
        }
      }
    }
  }

  /**
   * Interpolated density for a local position of the prepared chunk.
   * @param {number} lx 0..15
   * @param {number} y
   * @param {number} lz 0..15
   * @returns {number}
   */
  sample(lx, y, lz) {
    const i = lx >> 2;
    const k = lz >> 2;
    const j = y >> 2;
    if (j + 1 >= this.ny) return 1;
    const fx = (lx & 3) / STEP;
    const fz = (lz & 3) / STEP;
    const fy = (y & 3) / STEP;
    const ny = this.ny;
    const g = this.grid;
    const b00 = (i * NXZ + k) * ny + j;
    const b10 = ((i + 1) * NXZ + k) * ny + j;
    const b01 = (i * NXZ + k + 1) * ny + j;
    const b11 = ((i + 1) * NXZ + k + 1) * ny + j;
    const c00 = g[b00] + (g[b00 + 1] - g[b00]) * fy;
    const c10 = g[b10] + (g[b10 + 1] - g[b10]) * fy;
    const c01 = g[b01] + (g[b01 + 1] - g[b01]) * fy;
    const c11 = g[b11] + (g[b11 + 1] - g[b11]) * fy;
    const c0 = c00 + (c10 - c00) * fx;
    const c1 = c01 + (c11 - c01) * fx;
    return c0 + (c1 - c0) * fz;
  }

  /**
   * Interpolated density at an arbitrary world position (identical to what
   * {@link CaveCarver#sample} returns for the chunk containing it).
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {number}
   */
  densityAt(x, y, z) {
    const gx = Math.floor(x / STEP) * STEP;
    const gy = Math.floor(y / STEP) * STEP;
    const gz = Math.floor(z / STEP) * STEP;
    const fx = (x - gx) / STEP;
    const fy = (y - gy) / STEP;
    const fz = (z - gz) / STEP;
    const d = (dx, dy, dz) => this.rawDensity(gx + dx, gy + dy, gz + dz);
    const c00 = d(0, 0, 0) + (d(0, STEP, 0) - d(0, 0, 0)) * fy;
    const c10 = d(STEP, 0, 0) + (d(STEP, STEP, 0) - d(STEP, 0, 0)) * fy;
    const c01 = d(0, 0, STEP) + (d(0, STEP, STEP) - d(0, 0, STEP)) * fy;
    const c11 = d(STEP, 0, STEP) + (d(STEP, STEP, STEP) - d(STEP, 0, STEP)) * fy;
    const c0 = c00 + (c10 - c00) * fx;
    const c1 = c01 + (c11 - c01) * fx;
    return c0 + (c1 - c0) * fz;
  }
}

import { SimplexNoise } from './SimplexNoise.js';
import { mix32 } from '../random.js';

/**
 * Fractal (octave) noise built on {@link SimplexNoise}. Each instance owns its
 * own permutation derived from the seed and a salt, so different terrain
 * parameters never correlate with each other.
 * @module utils/noise/FractalNoise
 */

export class FractalNoise {
  /**
   * @param {number} seed world seed
   * @param {object} options
   * @param {number} [options.salt=0] distinguishes independent noise fields
   * @param {number} [options.octaves=4]
   * @param {number} [options.frequency=0.01] base frequency (1 / wavelength)
   * @param {number} [options.lacunarity=2] frequency multiplier per octave
   * @param {number} [options.persistence=0.5] amplitude multiplier per octave
   */
  constructor(seed, { salt = 0, octaves = 4, frequency = 0.01, lacunarity = 2, persistence = 0.5 } = {}) {
    this.noise = new SimplexNoise(mix32((seed ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0));
    this.octaves = octaves;
    this.frequency = frequency;
    this.lacunarity = lacunarity;
    this.persistence = persistence;
    // Per-octave offsets break up the symmetry around the origin.
    this.offsets = new Float64Array(octaves * 3);
    let h = mix32(seed + salt * 7919);
    for (let i = 0; i < this.offsets.length; i++) {
      h = mix32(h + i);
      this.offsets[i] = (h / 4294967296) * 1000 - 500;
    }
    let amp = 1;
    let sum = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp;
      amp *= persistence;
    }
    this.normalizer = 1 / sum;
  }

  /**
   * Normalised fractal Brownian motion in about [-1, 1].
   * @param {number} x
   * @param {number} z
   * @returns {number}
   */
  sample2D(x, z) {
    let freq = this.frequency;
    let amp = 1;
    let total = 0;
    const off = this.offsets;
    for (let i = 0; i < this.octaves; i++) {
      total += this.noise.noise2D(x * freq + off[i * 3], z * freq + off[i * 3 + 1]) * amp;
      freq *= this.lacunarity;
      amp *= this.persistence;
    }
    return total * this.normalizer;
  }

  /**
   * Normalised 3D fractal noise in about [-1, 1].
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {number}
   */
  sample3D(x, y, z) {
    let freq = this.frequency;
    let amp = 1;
    let total = 0;
    const off = this.offsets;
    for (let i = 0; i < this.octaves; i++) {
      total += this.noise.noise3D(x * freq + off[i * 3], y * freq + off[i * 3 + 1], z * freq + off[i * 3 + 2]) * amp;
      freq *= this.lacunarity;
      amp *= this.persistence;
    }
    return total * this.normalizer;
  }

  /**
   * Ridged multifractal noise in [0, 1]; sharp crests suited for mountains.
   * @param {number} x
   * @param {number} z
   * @returns {number}
   */
  ridged2D(x, z) {
    let freq = this.frequency;
    let amp = 1;
    let total = 0;
    let weight = 1;
    const off = this.offsets;
    for (let i = 0; i < this.octaves; i++) {
      let n = 1 - Math.abs(this.noise.noise2D(x * freq + off[i * 3], z * freq + off[i * 3 + 1]));
      n *= n;
      n *= weight;
      weight = Math.min(1, Math.max(0, n * 2));
      total += n * amp;
      freq *= this.lacunarity;
      amp *= this.persistence;
    }
    return total * this.normalizer;
  }
}

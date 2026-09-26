import { FractalNoise } from '../utils/noise/FractalNoise.js';
import { clamp, lerp, smoothstep } from '../utils/math.js';
import { SEA_LEVEL } from '../world/constants.js';
import { Biome } from './Biomes.js';

/**
 * Continuous climate fields and the column height function.
 *
 * The world is shaped by several low-frequency noise fields
 * (continentalness, erosion, weirdness, temperature, humidity, rivers).
 * Height is a continuous function of these fields, so terrain flows
 * smoothly across biome borders; the discrete biome is chosen afterwards
 * only to pick surface materials and vegetation.
 */

/** Spline control points mapping continentalness → base height. */
const C_POINTS = [-1.0, -0.55, -0.32, -0.14, -0.05, 0.03, 0.22, 0.55, 1.0];
const H_POINTS = [22, 33, 45, 55, 60.5, 64, 67, 72, 80];

/**
 * Piecewise-linear spline evaluation.
 * @param {number} v
 * @returns {number}
 */
function baseHeightSpline(v) {
  if (v <= C_POINTS[0]) return H_POINTS[0];
  for (let i = 1; i < C_POINTS.length; i++) {
    if (v <= C_POINTS[i]) {
      const t = (v - C_POINTS[i - 1]) / (C_POINTS[i] - C_POINTS[i - 1]);
      return lerp(H_POINTS[i - 1], H_POINTS[i], t);
    }
  }
  return H_POINTS[H_POINTS.length - 1];
}

/**
 * @typedef {object} ColumnSample
 * @property {number} height y of the top solid block
 * @property {number} biome biome id
 * @property {number} temperature -1..1
 * @property {number} humidity -1..1
 * @property {number} mountain 0..1 mountain factor
 * @property {number} river 0..1 river channel factor
 * @property {number} continental continentalness
 * @property {number} surfaceNoise -1..1 small scale variation
 */

export class Climate {
  /**
   * @param {number} seed
   */
  constructor(seed) {
    this.continental = new FractalNoise(seed, { salt: 1, octaves: 5, frequency: 1 / 1500 });
    this.erosion = new FractalNoise(seed, { salt: 2, octaves: 4, frequency: 1 / 900 });
    this.temperature = new FractalNoise(seed, { salt: 3, octaves: 3, frequency: 1 / 1400 });
    this.humidity = new FractalNoise(seed, { salt: 4, octaves: 3, frequency: 1 / 1000 });
    this.weirdness = new FractalNoise(seed, { salt: 5, octaves: 3, frequency: 1 / 550 });
    this.river = new FractalNoise(seed, { salt: 6, octaves: 4, frequency: 1 / 1300, persistence: 0.45 });
    this.detail = new FractalNoise(seed, { salt: 7, octaves: 5, frequency: 1 / 130 });
    this.ridges = new FractalNoise(seed, { salt: 8, octaves: 5, frequency: 1 / 360 });
    this.warp = new FractalNoise(seed, { salt: 9, octaves: 2, frequency: 1 / 420 });
    this.jitter = new FractalNoise(seed, { salt: 10, octaves: 2, frequency: 1 / 10 });
    this.dunes = new FractalNoise(seed, { salt: 11, octaves: 2, frequency: 1 / 36 });
    this.surface = new FractalNoise(seed, { salt: 12, octaves: 2, frequency: 1 / 22 });
  }

  /**
   * Samples every climate parameter and the terrain height of a column.
   * @param {number} x world x
   * @param {number} z world z
   * @param {ColumnSample} out object to fill (avoids allocations)
   * @returns {ColumnSample}
   */
  sample(x, z, out) {
    // Domain warping makes coastlines and biome borders organic.
    const wx = x + this.warp.sample2D(x, z) * 80;
    const wz = z + this.warp.sample2D(z + 5123, x - 7919) * 80;

    const c = clamp(this.continental.sample2D(wx, wz) * 1.9 + 0.16, -1, 1);
    const e = clamp(this.erosion.sample2D(wx, wz) * 1.9, -1, 1);
    const w = clamp(this.weirdness.sample2D(x, z) * 1.9, -1, 1);
    const detail = this.detail.sample2D(x, z) * 1.7;
    const jitter = this.jitter.sample2D(x, z) * 0.05;

    const land = smoothstep(-0.08, 0.12, c);
    const mountain = smoothstep(-0.12, -0.5, e) * smoothstep(-0.02, 0.28, c);
    const hilliness = smoothstep(0.12, 0.6, w);
    const valley = smoothstep(-0.25, -0.65, w);

    let height = baseHeightSpline(c);
    const roughness = lerp(3.5, 17, hilliness) * (1 - valley * 0.65);
    height += land * (detail * roughness - valley * 7);
    height += detail * 2.5 * (1 - land); // gentle sea floor relief

    if (mountain > 0) {
      const ridge = this.ridges.ridged2D(x, z);
      height += mountain * (Math.pow(ridge, 1.35) * 100 + 6);
    }

    let temperature = clamp(this.temperature.sample2D(wx, wz) * 1.9 + jitter, -1, 1);
    const humidity = clamp(this.humidity.sample2D(wx, wz) * 1.9 + jitter, -1, 1);

    // Desert dunes.
    const desertness = smoothstep(0.25, 0.5, temperature) * smoothstep(0.05, -0.2, humidity) * land * (1 - mountain);
    if (desertness > 0) height += desertness * (Math.abs(this.dunes.sample2D(x, z)) * 7 - 1.5);

    // Rivers carve winding channels where the river noise crosses zero.
    const r = Math.abs(this.river.sample2D(wx * 0.9, wz * 0.9) * 1.9);
    const strength = land * (1 - mountain * 0.55);
    const bank = smoothstep(0.17, 0.045, r) * strength;
    const channel = smoothstep(0.05, 0.0, r) * strength;
    if (bank > 0 && height > SEA_LEVEL + 1) height = lerp(height, SEA_LEVEL + 1, bank * 0.85);
    if (channel > 0 && height > SEA_LEVEL - 4) height = lerp(height, SEA_LEVEL - 4 + (1 - channel) * 3, channel);

    height = Math.floor(clamp(height, 4, 250));

    // Higher terrain is colder.
    temperature = clamp(temperature - Math.max(0, height - 95) / 110, -1, 1);

    out.height = height;
    out.temperature = temperature;
    out.humidity = humidity;
    out.mountain = mountain;
    out.river = channel;
    out.continental = c;
    out.surfaceNoise = this.surface.sample2D(x, z) * 1.7;
    out.biome = this.chooseBiome(out, hilliness, valley);
    return out;
  }

  /**
   * Picks the discrete biome of a sampled column.
   * @private
   * @param {ColumnSample} s
   * @param {number} hilliness
   * @param {number} valley
   * @returns {number} biome id
   */
  chooseBiome(s, hilliness, valley) {
    const { height, temperature: t, humidity: h } = s;
    const cold = t < -0.5;
    if (s.river > 0.45 && height < SEA_LEVEL) return cold ? Biome.FROZEN_RIVER.id : Biome.RIVER.id;
    if (height < SEA_LEVEL - 14) return cold ? Biome.FROZEN_OCEAN.id : Biome.DEEP_OCEAN.id;
    if (height < SEA_LEVEL - 1 && s.continental < 0.05) return cold ? Biome.FROZEN_OCEAN.id : Biome.OCEAN.id;
    if (height <= SEA_LEVEL + 2 && s.continental < 0.08 && s.river < 0.2) {
      if (s.mountain > 0.3) return Biome.STONE_SHORE.id;
      return cold ? Biome.SNOWY_BEACH.id : Biome.BEACH.id;
    }
    if (height < SEA_LEVEL - 1) return cold ? Biome.FROZEN_RIVER.id : Biome.RIVER.id;
    if (s.mountain > 0.38 && height > 88) return Biome.MOUNTAINS.id;
    if (cold) return h > 0.05 ? Biome.SNOWY_FOREST.id : Biome.SNOWY_PLAINS.id;
    if (t > 0.3 && h < -0.05) return Biome.DESERT.id;
    if (h > 0.18) return Biome.FOREST.id;
    if (hilliness > 0.55) return Biome.HILLS.id;
    if (valley > 0.5) return Biome.VALLEY.id;
    return Biome.PLAINS.id;
  }
}

/**
 * Creates an empty column sample object.
 * @returns {ColumnSample}
 */
export function createColumnSample() {
  return { height: 0, biome: 0, temperature: 0, humidity: 0, mountain: 0, river: 0, continental: 0, surfaceNoise: 0 };
}

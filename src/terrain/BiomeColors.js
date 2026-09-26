import { clamp, lerp, smoothstep } from '../utils/math.js';
import { Tint } from '../blocks/BlockShapes.js';

/**
 * Biome tint colours for grass, foliage and water derived from climate.
 * Climate is quantised into a 16×16 grid (temperature × humidity) so tints
 * are stable across neighbouring columns, which lets the greedy mesher merge
 * faces inside a biome.
 * @module terrain/BiomeColors
 */

/** Number of quantisation steps per climate axis. */
export const CLIMATE_STEPS = 16;

/**
 * Quantises temperature/humidity in [-1, 1] into a packed byte (t<<4 | h).
 * @param {number} temperature
 * @param {number} humidity
 * @returns {number}
 */
export function packClimate(temperature, humidity) {
  const t = clamp(Math.round(((temperature + 1) / 2) * (CLIMATE_STEPS - 1)), 0, CLIMATE_STEPS - 1);
  const h = clamp(Math.round(((humidity + 1) / 2) * (CLIMATE_STEPS - 1)), 0, CLIMATE_STEPS - 1);
  return (t << 4) | h;
}

function hex(c) {
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}

function mixColor(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/**
 * Computes a grass/foliage/water colour for normalised climate values.
 * @param {number} kind one of {@link Tint}
 * @param {number} t temperature 0..1
 * @param {number} h humidity 0..1
 * @returns {number[]} [r, g, b] 0..255
 */
function climateColor(kind, t, h) {
  const heat = smoothstep(0.55, 0.95, t);
  const cold = smoothstep(0.35, 0.05, t);
  const wet = smoothstep(0.5, 0.95, h);
  const dry = smoothstep(0.45, 0.1, h);
  if (kind === Tint.WATER) {
    let c = hex(0x3f76e4);
    c = mixColor(c, hex(0x3d57d6), cold);
    c = mixColor(c, hex(0x44aff5), heat * 0.6);
    return c;
  }
  let c = kind === Tint.FOLIAGE ? hex(0x5aa83a) : hex(0x7cbd4b);
  c = mixColor(c, kind === Tint.FOLIAGE ? hex(0x61997a) : hex(0x86b59a), cold);
  c = mixColor(c, kind === Tint.FOLIAGE ? hex(0xaea42a) : hex(0xbfb755), heat * dry);
  c = mixColor(c, kind === Tint.FOLIAGE ? hex(0x30bb0b) : hex(0x4fb52e), wet * (1 - cold));
  return c;
}

/**
 * Lookup table: [kind][climateByte] → packed 0xRRGGBB.
 * @type {Uint32Array[]}
 */
export const TINT_LUT = [0, 1, 2, 3].map((kind) => {
  const lut = new Uint32Array(256);
  for (let ti = 0; ti < CLIMATE_STEPS; ti++) {
    for (let hi = 0; hi < CLIMATE_STEPS; hi++) {
      const idx = (ti << 4) | hi;
      if (kind === Tint.NONE) {
        lut[idx] = 0xffffff;
        continue;
      }
      const [r, g, b] = climateColor(kind, ti / (CLIMATE_STEPS - 1), hi / (CLIMATE_STEPS - 1));
      lut[idx] = (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
    }
  }
  return lut;
});

/**
 * Packed RGB tint of a block with the given tint kind at a climate byte.
 * @param {number} kind one of {@link Tint}
 * @param {number} climate packed climate byte
 * @returns {number} 0xRRGGBB
 */
export function tintColor(kind, climate) {
  return TINT_LUT[kind][climate];
}

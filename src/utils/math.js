/**
 * Small, allocation-free math helpers shared by every system.
 * @module utils/math
 */

/**
 * Clamps a value into the inclusive range [min, max].
 * @param {number} v
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

/**
 * Linear interpolation between a and b.
 * @param {number} a
 * @param {number} b
 * @param {number} t interpolation factor, usually in [0, 1]
 * @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Inverse of {@link lerp}: where v lies between a and b (unclamped).
 * @param {number} a
 * @param {number} b
 * @param {number} v
 * @returns {number}
 */
export function invLerp(a, b, v) {
  return a === b ? 0 : (v - a) / (b - a);
}

/**
 * Hermite smoothstep between edge0 and edge1 (clamped).
 * @param {number} edge0
 * @param {number} edge1
 * @param {number} x
 * @returns {number}
 */
export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Maps v from [inMin, inMax] to [outMin, outMax] with clamping.
 * @param {number} v
 * @param {number} inMin
 * @param {number} inMax
 * @param {number} outMin
 * @param {number} outMax
 * @returns {number}
 */
export function remap(v, inMin, inMax, outMin, outMax) {
  return lerp(outMin, outMax, clamp(invLerp(inMin, inMax, v), 0, 1));
}

/**
 * Positive modulo that always returns a value in [0, m).
 * @param {number} n
 * @param {number} m
 * @returns {number}
 */
export function mod(n, m) {
  return ((n % m) + m) % m;
}

/**
 * Frame-rate independent exponential damping factor.
 * Use as `value = lerp(value, target, damp(rate, dt))`.
 * @param {number} rate higher = faster convergence
 * @param {number} dt seconds
 * @returns {number}
 */
export function damp(rate, dt) {
  return 1 - Math.exp(-rate * dt);
}

/**
 * Shortest signed difference between two angles in radians.
 * @param {number} from
 * @param {number} to
 * @returns {number}
 */
export function angleDelta(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Interpolates angles along the shortest arc.
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @returns {number}
 */
export function lerpAngle(a, b, t) {
  return a + angleDelta(a, b) * t;
}

/** @type {number} */
export const DEG2RAD = Math.PI / 180;
/** @type {number} */
export const RAD2DEG = 180 / Math.PI;

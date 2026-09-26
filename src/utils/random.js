/**
 * Deterministic random number utilities. Every procedural system derives its
 * randomness from these helpers so that worlds are reproducible from a seed.
 * @module utils/random
 */

/**
 * Converts any string into a 32-bit unsigned seed (FNV-1a variant).
 * Numeric strings are parsed directly so "12345" yields seed 12345.
 * @param {string|number} input
 * @returns {number}
 */
export function seedFromString(input) {
  if (typeof input === 'number' && Number.isFinite(input)) return input >>> 0;
  const str = String(input).trim();
  if (/^-?\d+$/.test(str)) {
    const n = Number(str);
    if (Number.isSafeInteger(n)) return (n % 4294967296 + 4294967296) % 4294967296 >>> 0;
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Integer finaliser (murmur3 fmix32). Spreads bits of a 32-bit integer.
 * @param {number} h
 * @returns {number} unsigned 32-bit integer
 */
export function mix32(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Hashes a seed with two integer coordinates.
 * @param {number} seed
 * @param {number} x
 * @param {number} z
 * @returns {number} unsigned 32-bit hash
 */
export function hash2(seed, x, z) {
  let h = seed ^ Math.imul(x | 0, 0x27d4eb2d);
  h = mix32(h ^ Math.imul(z | 0, 0x165667b1));
  return h;
}

/**
 * Hashes a seed with three integer coordinates.
 * @param {number} seed
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {number} unsigned 32-bit hash
 */
export function hash3(seed, x, y, z) {
  let h = seed ^ Math.imul(x | 0, 0x27d4eb2d);
  h = mix32(h ^ Math.imul(y | 0, 0x9e3779b1));
  h = mix32(h ^ Math.imul(z | 0, 0x165667b1));
  return h;
}

/**
 * Converts a 32-bit hash into a float in [0, 1).
 * @param {number} h
 * @returns {number}
 */
export function hashToUnit(h) {
  return (h >>> 0) / 4294967296;
}

/**
 * Small, fast, seedable PRNG (mulberry32) wrapped with convenience helpers.
 */
export class SeededRandom {
  /**
   * @param {number} seed any 32-bit integer
   */
  constructor(seed) {
    this.state = seed >>> 0;
  }

  /**
   * Re-seeds the generator.
   * @param {number} seed
   */
  setSeed(seed) {
    this.state = seed >>> 0;
  }

  /**
   * Next float in [0, 1).
   * @returns {number}
   */
  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Integer in [min, max] inclusive.
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /**
   * Float in [min, max).
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  range(min, max) {
    return min + this.next() * (max - min);
  }

  /**
   * Returns true with probability p.
   * @param {number} p
   * @returns {boolean}
   */
  chance(p) {
    return this.next() < p;
  }

  /**
   * Picks a random element of a non-empty array.
   * @template T
   * @param {T[]} arr
   * @returns {T}
   */
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /**
   * Fisher-Yates shuffles an array in place.
   * @template T
   * @param {T[]|Uint8Array} arr
   * @returns {T[]|Uint8Array}
   */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }
}

/**
 * Generates a random seed using Math.random (for new worlds without a seed).
 * @returns {number}
 */
export function randomSeed() {
  return Math.floor(Math.random() * 4294967296) >>> 0;
}

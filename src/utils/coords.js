import { CHUNK_SHIFT, CHUNK_MASK } from '../world/constants.js';

/**
 * Coordinate helpers for converting between world, chunk and local space and
 * for building compact numeric map keys.
 * @module utils/coords
 */

const KEY_OFFSET = 8388608; // 2^23 — supports ±8M chunks (±134M blocks) per axis
const KEY_SCALE = 16777216; // 2^24 (keys stay below 2^48, section keys below 2^52)

/**
 * Packs chunk coordinates into a single safe-integer key.
 * @param {number} cx
 * @param {number} cz
 * @returns {number}
 */
export function chunkKey(cx, cz) {
  return (cx + KEY_OFFSET) * KEY_SCALE + (cz + KEY_OFFSET);
}

/**
 * Unpacks the x coordinate of a {@link chunkKey}.
 * @param {number} key
 * @returns {number}
 */
export function chunkKeyX(key) {
  return Math.floor(key / KEY_SCALE) - KEY_OFFSET;
}

/**
 * Unpacks the z coordinate of a {@link chunkKey}.
 * @param {number} key
 * @returns {number}
 */
export function chunkKeyZ(key) {
  return (key % KEY_SCALE) - KEY_OFFSET;
}

/**
 * World block coordinate → chunk coordinate.
 * @param {number} v world x or z (integer)
 * @returns {number}
 */
export function toChunk(v) {
  return v >> CHUNK_SHIFT;
}

/**
 * World block coordinate → local chunk coordinate (0..15).
 * @param {number} v world x or z (integer)
 * @returns {number}
 */
export function toLocal(v) {
  return v & CHUNK_MASK;
}

/**
 * Packs a section coordinate into a key (sections are 16³ render units).
 * @param {number} cx
 * @param {number} sy section index 0..15
 * @param {number} cz
 * @returns {number}
 */
export function sectionKey(cx, sy, cz) {
  return chunkKey(cx, cz) * 16 + sy;
}

/**
 * String key for a block position (used by sparse maps such as block entities).
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {string}
 */
export function blockPosKey(x, y, z) {
  return `${x},${y},${z}`;
}

/**
 * World-wide dimensional constants shared by generation, storage, meshing and
 * physics. Chunks are 16×16 columns, 256 blocks tall, split into 16 vertical
 * render sections of 16³ blocks.
 * @module world/constants
 */

/** Horizontal chunk size in blocks (x and z). */
export const CHUNK_SIZE = 16;
/** log2(CHUNK_SIZE), used for fast world→chunk coordinate conversion. */
export const CHUNK_SHIFT = 4;
/** Bit mask for local coordinates inside a chunk. */
export const CHUNK_MASK = 15;
/** Vertical world height in blocks. */
export const CHUNK_HEIGHT = 256;
/** Section (render sub-chunk) edge length. */
export const SECTION_SIZE = 16;
/** Number of vertical sections per chunk. */
export const SECTIONS_PER_CHUNK = CHUNK_HEIGHT / SECTION_SIZE;
/** Blocks in one horizontal layer of a chunk. */
export const LAYER_AREA = CHUNK_SIZE * CHUNK_SIZE;
/** Total blocks per chunk. */
export const CHUNK_VOLUME = LAYER_AREA * CHUNK_HEIGHT;
/** Y coordinate of the ocean surface (water fills y <= SEA_LEVEL). */
export const SEA_LEVEL = 62;
/** Maximum light level for sky and block light. */
export const MAX_LIGHT = 15;

/**
 * Index of a block inside chunk arrays: x + z*16 + y*256.
 * @param {number} x local x (0..15)
 * @param {number} y world y (0..255)
 * @param {number} z local z (0..15)
 * @returns {number}
 */
export function blockIndex(x, y, z) {
  return x | (z << 4) | (y << 8);
}

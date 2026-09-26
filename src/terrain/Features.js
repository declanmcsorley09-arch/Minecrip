import { BlockIds } from '../blocks/index.js';

/**
 * Multi-block world features (trees, boulders). Each feature writes through
 * a `place` callback so the generator can clip writes to the chunk being
 * generated; given the same random stream, a feature produces identical
 * blocks in every chunk it overlaps.
 * @module terrain/Features
 */

/**
 * @callback PlaceFn
 * @param {number} x world x
 * @param {number} y world y
 * @param {number} z world z
 * @param {number} id block id
 * @param {boolean} force overwrite anything except bedrock (logs); otherwise only air/plants
 */

/** Maximum horizontal reach of any feature from its origin column. */
export const FEATURE_RADIUS = 3;

const LOG = BlockIds.oak_log;
const LEAVES = BlockIds.oak_leaves;

/**
 * Classic round oak tree.
 * @param {PlaceFn} place
 * @param {number} x trunk column
 * @param {number} y ground block y (trunk starts above it)
 * @param {number} z
 * @param {import('../utils/random.js').SeededRandom} rng
 */
export function oakTree(place, x, y, z, rng) {
  const height = 4 + rng.int(0, 2);
  const top = y + height;
  for (let ly = top - 2; ly <= top + 1; ly++) {
    const rel = ly - top;
    const radius = rel <= -1 ? 2 : 1;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const corner = Math.abs(dx) === radius && Math.abs(dz) === radius;
        if (corner && (rel >= 0 || rng.chance(0.45))) continue;
        if (rel === 1 && radius === 1 && corner) continue;
        place(x + dx, ly, z + dz, LEAVES, false);
      }
    }
  }
  for (let i = 1; i <= height; i++) place(x, y + i, z, LOG, true);
}

/**
 * Larger oak with a two-lobed canopy.
 * @param {PlaceFn} place
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {import('../utils/random.js').SeededRandom} rng
 */
export function largeOakTree(place, x, y, z, rng) {
  const height = 6 + rng.int(0, 2);
  const top = y + height;
  const blob = (cx, cy, cz, r) => {
    const ir = Math.ceil(r);
    for (let dy = -ir; dy <= ir; dy++) {
      for (let dx = -ir; dx <= ir; dx++) {
        for (let dz = -ir; dz <= ir; dz++) {
          const d = dx * dx + dy * dy * 1.6 + dz * dz;
          if (d <= r * r + (rng.next() - 0.5) * 1.5) place(cx + dx, cy + dy, cz + dz, LEAVES, false);
        }
      }
    }
  };
  blob(x, top, z, 3);
  const bx = rng.int(-1, 1);
  const bz = rng.int(-1, 1);
  blob(x + bx, top - 3, z + bz, 2.2);
  for (let i = 1; i <= height; i++) place(x, y + i, z, LOG, true);
  // A short branch toward the lower lobe.
  if (bx !== 0 || bz !== 0) place(x + bx, top - 3, z + bz, LOG, true);
}

/**
 * Conical conifer.
 * @param {PlaceFn} place
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {import('../utils/random.js').SeededRandom} rng
 */
export function pineTree(place, x, y, z, rng) {
  const height = 6 + rng.int(0, 3);
  const top = y + height;
  place(x, top + 1, z, LEAVES, false);
  let radius = 0;
  for (let ly = top; ly >= y + 3; ly--) {
    const step = top - ly;
    radius = step === 0 ? 1 : step % 2 === 1 ? Math.min(2, 1 + (step >> 2)) : 1;
    if (step > 4 && step % 2 === 1) radius = Math.min(3, radius + 1);
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (Math.abs(dx) + Math.abs(dz) > radius + (radius > 1 ? 1 : 0)) continue;
        place(x + dx, ly, z + dz, LEAVES, false);
      }
    }
  }
  for (let i = 1; i <= height; i++) place(x, y + i, z, LOG, true);
}

/**
 * Mossy boulder partially sunk into the ground.
 * @param {PlaceFn} place
 * @param {number} x
 * @param {number} y ground block y
 * @param {number} z
 * @param {import('../utils/random.js').SeededRandom} rng
 */
export function boulder(place, x, y, z, rng) {
  const r = 1 + rng.next() * 1.2;
  const ir = Math.ceil(r);
  for (let dy = -1; dy <= ir; dy++) {
    for (let dx = -ir; dx <= ir; dx++) {
      for (let dz = -ir; dz <= ir; dz++) {
        const d = dx * dx + dy * dy * 1.3 + dz * dz;
        if (d > r * r + rng.next() * 0.8) continue;
        const pick = rng.next();
        const id = pick < 0.5 ? BlockIds.cobblestone : pick < 0.8 ? BlockIds.mossy_cobblestone : BlockIds.stone;
        place(x + dx, y + 1 + dy, z + dz, id, dy < 0);
      }
    }
  }
}

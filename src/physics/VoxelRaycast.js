import { blockRegistry } from '../blocks/index.js';
import { AABB } from './AABB.js';

/**
 * Voxel ray casting using the Amanatides & Woo grid traversal. Visits only
 * the cells the ray passes through (no fixed-step sampling), then refines
 * hits against each block's selection box so plants, torches and cacti are
 * picked precisely.
 */

/**
 * @typedef {object} RayHit
 * @property {number} x hit block x
 * @property {number} y
 * @property {number} z
 * @property {number} face face index hit (see blocks/BlockShapes Face)
 * @property {number} nx face normal
 * @property {number} ny
 * @property {number} nz
 * @property {number} distance distance along the ray
 * @property {number} px hit point
 * @property {number} py
 * @property {number} pz
 * @property {number} id block id
 */

const FACE_NORMALS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
const box = new AABB();

/**
 * Casts a ray against the world.
 * @param {{getBlock: (x:number,y:number,z:number)=>number}} world
 * @param {number} ox origin
 * @param {number} oy
 * @param {number} oz
 * @param {number} dx direction (normalised)
 * @param {number} dy
 * @param {number} dz
 * @param {number} maxDistance
 * @param {object} [options]
 * @param {boolean} [options.fluids=false] stop at fluid blocks
 * @returns {RayHit|null}
 */
export function raycastVoxels(world, ox, oy, oz, dx, dy, dz, maxDistance, options = {}) {
  const fluids = options.fluids ?? false;
  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = stepX > 0 ? (x + 1 - ox) * tDeltaX : stepX < 0 ? (ox - x) * tDeltaX : Infinity;
  let tMaxY = stepY > 0 ? (y + 1 - oy) * tDeltaY : stepY < 0 ? (oy - y) * tDeltaY : Infinity;
  let tMaxZ = stepZ > 0 ? (z + 1 - oz) * tDeltaZ : stepZ < 0 ? (oz - z) * tDeltaZ : Infinity;
  let face = -1;
  let t = 0;

  for (let i = 0; i < 512 && t <= maxDistance; i++) {
    const id = y >= 0 && y < 256 ? world.getBlock(x, y, z) : 0;
    if (id !== 0) {
      const def = blockRegistry.byId[id];
      const sel = def.selection;
      if (sel || (fluids && def.fluid)) {
        const s = sel ?? [0, 0, 0, 1, 0.875, 1];
        const full = s[0] === 0 && s[1] === 0 && s[2] === 0 && s[3] === 1 && s[4] === 1 && s[5] === 1;
        if (full && face >= 0) {
          const n = FACE_NORMALS[face];
          return {
            x, y, z, face, nx: n[0], ny: n[1], nz: n[2], distance: t,
            px: ox + dx * t, py: oy + dy * t, pz: oz + dz * t, id,
          };
        }
        box.set(x + s[0], y + s[1], z + s[2], x + s[3], y + s[4], z + s[5]);
        const hit = box.raycast(ox, oy, oz, dx, dy, dz);
        if (hit && hit.t <= maxDistance) {
          const f = hit.face >= 0 ? hit.face : 2;
          const n = FACE_NORMALS[f];
          return {
            x, y, z, face: f, nx: n[0], ny: n[1], nz: n[2], distance: hit.t,
            px: ox + dx * hit.t, py: oy + dy * hit.t, pz: oz + dz * hit.t, id,
          };
        }
      }
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
      face = stepX > 0 ? 1 : 0;
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
      face = stepY > 0 ? 3 : 2;
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      face = stepZ > 0 ? 5 : 4;
    }
  }
  return null;
}

import { AABB } from './AABB.js';
import { blockRegistry } from '../blocks/index.js';

/**
 * Voxel collision queries shared by players, mobs, items and falling blocks.
 * @module physics/Collision
 */

/**
 * @typedef {object} BlockGetter
 * @property {(x:number, y:number, z:number) => number} getBlock
 */

const boxPool = [];
for (let i = 0; i < 256; i++) boxPool.push(new AABB());

/**
 * Collects the collision boxes of all blocks overlapping `region`.
 * Returned boxes are pooled and valid until the next call.
 * @param {BlockGetter} world
 * @param {AABB} region
 * @param {AABB[]} out
 * @returns {AABB[]}
 */
export function collectBlockBoxes(world, region, out) {
  out.length = 0;
  const x0 = Math.floor(region.minX - 1e-7);
  const x1 = Math.floor(region.maxX + 1e-7);
  const y0 = Math.floor(region.minY - 1e-7) - 1; // fences etc. could extend down; also catches boxes shorter than 1
  const y1 = Math.floor(region.maxY + 1e-7);
  const z0 = Math.floor(region.minZ - 1e-7);
  const z1 = Math.floor(region.maxZ + 1e-7);
  let n = 0;
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      for (let y = y0; y <= y1; y++) {
        if (y < 0) continue;
        const id = world.getBlock(x, y, z);
        if (id === 0) continue;
        const c = blockRegistry.byId[id].collision;
        if (!c) continue;
        if (n >= boxPool.length) boxPool.push(new AABB());
        const b = boxPool[n++].set(x + c[0], y + c[1], z + c[2], x + c[3], y + c[4], z + c[5]);
        if (b.maxX <= region.minX || b.minX >= region.maxX || b.maxY <= region.minY || b.minY >= region.maxY || b.maxZ <= region.minZ || b.minZ >= region.maxZ) {
          n--;
          continue;
        }
        out.push(b);
      }
    }
  }
  return out;
}

const sweep = new AABB();
const boxes = [];

/**
 * @typedef {object} MoveResult
 * @property {number} dx applied movement
 * @property {number} dy
 * @property {number} dz
 * @property {boolean} collidedX
 * @property {boolean} collidedY
 * @property {boolean} collidedZ
 * @property {boolean} onGround landed on something while moving down
 */

/**
 * Moves `box` by (dx, dy, dz), stopping at solid blocks. Axis order is Y, X,
 * Z which produces natural sliding along walls.
 * @param {BlockGetter} world
 * @param {AABB} box mutated in place
 * @param {number} dx
 * @param {number} dy
 * @param {number} dz
 * @param {MoveResult} out
 * @returns {MoveResult}
 */
export function moveBox(world, box, dx, dy, dz, out) {
  sweep.copy(box);
  if (dx < 0) sweep.minX += dx;
  else sweep.maxX += dx;
  if (dy < 0) sweep.minY += dy;
  else sweep.maxY += dy;
  if (dz < 0) sweep.minZ += dz;
  else sweep.maxZ += dz;
  collectBlockBoxes(world, sweep, boxes);

  const ody = dy;
  for (let i = 0; i < boxes.length; i++) dy = box.clipY(boxes[i], dy);
  box.translate(0, dy, 0);
  const odx = dx;
  for (let i = 0; i < boxes.length; i++) dx = box.clipX(boxes[i], dx);
  box.translate(dx, 0, 0);
  const odz = dz;
  for (let i = 0; i < boxes.length; i++) dz = box.clipZ(boxes[i], dz);
  box.translate(0, 0, dz);

  out.dx = dx;
  out.dy = dy;
  out.dz = dz;
  out.collidedX = dx !== odx;
  out.collidedY = dy !== ody;
  out.collidedZ = dz !== odz;
  out.onGround = ody < 0 && dy !== ody;
  return out;
}

/**
 * Whether any solid block box intersects `box`.
 * @param {BlockGetter} world
 * @param {AABB} box
 * @returns {boolean}
 */
export function isColliding(world, box) {
  return collectBlockBoxes(world, box, boxes).length > 0;
}

/**
 * Fraction of the box's height submerged in fluid blocks and whether the
 * given eye height is underwater.
 * @param {BlockGetter} world
 * @param {AABB} box
 * @returns {number} 0..1
 */
export function fluidSubmersion(world, box) {
  const x0 = Math.floor(box.minX + 0.001);
  const x1 = Math.floor(box.maxX - 0.001);
  const z0 = Math.floor(box.minZ + 0.001);
  const z1 = Math.floor(box.maxZ - 0.001);
  const y0 = Math.floor(box.minY);
  const y1 = Math.floor(box.maxY);
  let top = -Infinity;
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      for (let y = y0; y <= y1; y++) {
        const id = world.getBlock(x, y, z);
        if (!blockRegistry.fluid[id]) continue;
        const above = world.getBlock(x, y + 1, z);
        const surface = y + (blockRegistry.fluid[above] ? 1 : 0.875);
        if (surface > box.minY && surface > top) top = surface;
      }
    }
  }
  if (top === -Infinity) return 0;
  return Math.min(1, (top - box.minY) / (box.maxY - box.minY));
}

/**
 * Whether a point is inside a fluid block (below its surface).
 * @param {BlockGetter} world
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {boolean}
 */
export function isPointInFluid(world, x, y, z) {
  const bx = Math.floor(x);
  const by = Math.floor(y);
  const bz = Math.floor(z);
  const id = world.getBlock(bx, by, bz);
  if (!blockRegistry.fluid[id]) return false;
  const above = world.getBlock(bx, by + 1, bz);
  const surface = by + (blockRegistry.fluid[above] ? 1 : 0.875);
  return y < surface;
}

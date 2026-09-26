import { blockRegistry, BlockIds } from './index.js';
import { Face } from './BlockShapes.js';

/**
 * Block behaviour rules that depend on the surrounding world: placement
 * variant resolution and support ("can this block stay here?") checks.
 * Pure logic, shared by client prediction and the authoritative server.
 * @module blocks/BlockBehaviors
 */

/**
 * @typedef {object} BlockReader
 * @property {(x:number, y:number, z:number) => number} getBlock
 */

const SOIL = new Set([BlockIds.grass_block, BlockIds.dirt, BlockIds.snowy_grass_block]);

/**
 * Picks the concrete block variant to place for an item.
 * @param {number} baseId block id of the item being placed
 * @param {number} face face of the clicked block (see {@link Face})
 * @param {number} yaw player yaw in radians (camera rotation.y)
 * @returns {number} block id to place, or 0 if placement is impossible
 */
export function resolvePlacement(baseId, face, yaw) {
  const def = blockRegistry.get(baseId);
  switch (def.placement) {
    case 'axis':
      if (face === Face.EAST || face === Face.WEST) return BlockIds.oak_log_x;
      if (face === Face.SOUTH || face === Face.NORTH) return BlockIds.oak_log_z;
      return BlockIds.oak_log;
    case 'facing': {
      // Front faces the player: opposite of the view direction.
      const lookX = -Math.sin(yaw);
      const lookZ = -Math.cos(yaw);
      let facing;
      if (Math.abs(lookX) > Math.abs(lookZ)) facing = lookX > 0 ? 'west' : 'east';
      else facing = lookZ > 0 ? 'north' : 'south';
      return facing === 'north' ? BlockIds.furnace : BlockIds[`furnace_${facing}`];
    }
    case 'torch':
      switch (face) {
        case Face.TOP:
          return BlockIds.torch;
        case Face.EAST:
          return BlockIds.wall_torch_east;
        case Face.WEST:
          return BlockIds.wall_torch_west;
        case Face.SOUTH:
          return BlockIds.wall_torch_south;
        case Face.NORTH:
          return BlockIds.wall_torch_north;
        default:
          return 0;
      }
    default:
      return baseId;
  }
}

/**
 * Whether a block provides a sturdy face for attachments (torches etc.).
 * @param {number} id
 * @returns {boolean}
 */
export function isSturdy(id) {
  return blockRegistry.opaque[id] === 1 || (blockRegistry.solid[id] === 1 && blockRegistry.shape[id] === 1);
}

/**
 * Checks whether the block `id` can exist at (x, y, z) given its neighbours.
 * @param {BlockReader} world
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} id
 * @returns {boolean}
 */
export function canBlockStay(world, x, y, z, id) {
  const def = blockRegistry.get(id);
  switch (def.support) {
    case 'soil': {
      const below = world.getBlock(x, y - 1, z);
      return SOIL.has(below);
    }
    case 'sand': {
      const below = world.getBlock(x, y - 1, z);
      if (id === BlockIds.cactus) {
        if (below !== BlockIds.sand && below !== BlockIds.cactus) return false;
        const s = blockRegistry.solid;
        return !(s[world.getBlock(x + 1, y, z)] || s[world.getBlock(x - 1, y, z)] || s[world.getBlock(x, y, z + 1)] || s[world.getBlock(x, y, z - 1)]);
      }
      return below === BlockIds.sand || SOIL.has(below);
    }
    case 'attached': {
      switch (blockRegistry.aux[id]) {
        case 1:
          return isSturdy(world.getBlock(x - 1, y, z));
        case 2:
          return isSturdy(world.getBlock(x + 1, y, z));
        case 3:
          return isSturdy(world.getBlock(x, y, z - 1));
        case 4:
          return isSturdy(world.getBlock(x, y, z + 1));
        default:
          return isSturdy(world.getBlock(x, y - 1, z));
      }
    }
    default:
      return true;
  }
}

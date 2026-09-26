/**
 * Enumerations describing how blocks are rendered, how they interact with
 * light, and how they sound. Kept as small integers so they can live in typed
 * lookup tables consumed by the mesher (which runs inside Web Workers).
 * @module blocks/BlockShapes
 */

/** Render shape of a block. */
export const Shape = Object.freeze({
  NONE: 0, // not rendered (air)
  CUBE: 1, // full cube, greedy meshed
  CROSS: 2, // two diagonal quads (plants)
  TORCH: 3, // thin stick, optionally leaning against a wall
  LIQUID: 4, // cube with lowered top when exposed (water)
  CACTUS: 5, // cube with sides inset by 1/16
});

/** Render pass a block's geometry is emitted into. */
export const RenderLayer = Object.freeze({
  OPAQUE: 0,
  CUTOUT: 1, // alpha tested (leaves, glass, plants)
  TRANSLUCENT: 2, // alpha blended (water, ice)
});

/** Biome tint applied to tint-masked texels. */
export const Tint = Object.freeze({
  NONE: 0,
  GRASS: 1,
  FOLIAGE: 2,
  WATER: 3,
});

/** Material family, used for sounds and particles. */
export const SoundType = Object.freeze({
  NONE: 'none',
  STONE: 'stone',
  WOOD: 'wood',
  GRASS: 'grass',
  GRAVEL: 'gravel',
  SAND: 'sand',
  SNOW: 'snow',
  GLASS: 'glass',
  CLOTH: 'cloth',
  WATER: 'water',
});

/** Preferred tool classes. */
export const ToolType = Object.freeze({
  NONE: 'none',
  PICKAXE: 'pickaxe',
  AXE: 'axe',
  SHOVEL: 'shovel',
  SWORD: 'sword',
});

/**
 * Face order used everywhere (textures, meshing, lighting):
 * 0:+X east, 1:-X west, 2:+Y top, 3:-Y bottom, 4:+Z south, 5:-Z north.
 */
export const Face = Object.freeze({
  EAST: 0,
  WEST: 1,
  TOP: 2,
  BOTTOM: 3,
  SOUTH: 4,
  NORTH: 5,
});

/** Unit normals for each {@link Face}, flattened as [x,y,z] triples. */
export const FACE_NORMALS = Object.freeze([
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
]);

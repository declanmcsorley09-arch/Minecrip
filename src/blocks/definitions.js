import { Shape, RenderLayer, Tint, SoundType, ToolType } from './BlockShapes.js';

/**
 * Declarative list of every block in the game.
 *
 * Adding a block is a single `register` call: give it a new id, a name and
 * (optionally) texture names. Unknown texture names are generated
 * procedurally from `mapColor`, so no art pipeline is required.
 *
 * @param {import('./BlockRegistry.js').BlockRegistry} r
 */
export function registerDefaultBlocks(r) {
  const P = ToolType.PICKAXE;
  const A = ToolType.AXE;
  const S = ToolType.SHOVEL;

  r.register({ id: 1, name: 'stone', hardness: 1.5, tool: P, requiresTool: true, drops: [{ item: 'cobblestone' }], mapColor: '#7d7d7d' });
  r.register({
    id: 2, name: 'grass_block', displayName: 'Grass Block', hardness: 0.6, tool: S, sound: SoundType.GRASS,
    textures: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' }, tint: Tint.GRASS,
    drops: [{ item: 'dirt' }], mapColor: '#5f9f35',
  });
  r.register({ id: 3, name: 'dirt', hardness: 0.5, tool: S, sound: SoundType.GRAVEL, mapColor: '#866043' });
  r.register({ id: 4, name: 'cobblestone', hardness: 2, tool: P, requiresTool: true, mapColor: '#7a7a7a' });
  r.register({ id: 5, name: 'oak_planks', hardness: 2, tool: A, sound: SoundType.WOOD, textures: { all: 'planks' }, mapColor: '#a2824e' });
  r.register({ id: 6, name: 'sand', hardness: 0.5, tool: S, sound: SoundType.SAND, gravity: true, mapColor: '#dbd3a0' });
  r.register({ id: 7, name: 'gravel', hardness: 0.6, tool: S, sound: SoundType.GRAVEL, gravity: true, mapColor: '#857f7e' });

  const log = { hardness: 2, tool: A, sound: SoundType.WOOD, mapColor: '#6b5233', placement: 'axis' };
  r.register({ ...log, id: 8, name: 'oak_log', textures: { side: 'log_side', end: 'log_top' }, variantData: { axis: 'y' } });
  r.register({
    ...log, id: 9, name: 'oak_log_x', variantOf: 'oak_log', variantData: { axis: 'x' },
    textures: { east: 'log_top', west: 'log_top', side: 'log_side', top: 'log_side', bottom: 'log_side' },
    textureRotation: [0, 0, 1, 1, 1, 1],
  });
  r.register({
    ...log, id: 10, name: 'oak_log_z', variantOf: 'oak_log', variantData: { axis: 'z' },
    textures: { south: 'log_top', north: 'log_top', side: 'log_side', top: 'log_side', bottom: 'log_side' },
    textureRotation: [1, 1, 0, 0, 0, 0],
  });
  r.register({
    id: 11, name: 'oak_leaves', hardness: 0.2, layer: RenderLayer.CUTOUT, opaque: false, lightFilter: 1,
    sound: SoundType.GRASS, tint: Tint.FOLIAGE, textures: { all: 'leaves' }, mapColor: '#3f7a26',
    drops: [{ item: 'apple', chance: 0.05 }, { item: 'stick', chance: 0.04, max: 2 }],
  });
  r.register({
    id: 12, name: 'glass', hardness: 0.3, layer: RenderLayer.CUTOUT, opaque: false, cullSelf: true,
    sound: SoundType.GLASS, drops: [], mapColor: '#c8e6f0',
  });
  r.register({
    id: 13, name: 'water', hardness: 100, shape: Shape.LIQUID, layer: RenderLayer.TRANSLUCENT, opaque: false,
    solid: false, collision: null, selection: null, fluid: true, replaceable: true, cullSelf: true, lightFilter: 1,
    sound: SoundType.WATER, tint: Tint.WATER, hasItem: false, drops: [], mapColor: '#3f76e4',
  });
  r.register({ id: 14, name: 'snow_block', displayName: 'Snow', hardness: 0.2, tool: S, sound: SoundType.SNOW, textures: { all: 'snow' }, mapColor: '#f0fbfb' });
  r.register({
    id: 15, name: 'snowy_grass_block', displayName: 'Snowy Grass Block', hardness: 0.6, tool: S, sound: SoundType.SNOW,
    textures: { top: 'snow', bottom: 'dirt', side: 'grass_snow_side' }, drops: [{ item: 'dirt' }], mapColor: '#e8f2f2',
  });
  r.register({
    id: 16, name: 'ice', hardness: 0.5, tool: P, layer: RenderLayer.TRANSLUCENT, opaque: false, cullSelf: true,
    lightFilter: 1, sound: SoundType.GLASS, drops: [], slipperiness: 0.98, mapColor: '#91b4fe',
  });
  r.register({ id: 17, name: 'bedrock', hardness: -1, mapColor: '#3a3a3a', hasItem: true });

  const ore = { hardness: 3, tool: P, requiresTool: true };
  r.register({ ...ore, id: 18, name: 'coal_ore', harvestLevel: 0, drops: [{ item: 'coal' }], mapColor: '#6a6a6a' });
  r.register({ ...ore, id: 19, name: 'iron_ore', harvestLevel: 1, mapColor: '#a08b7a' });
  r.register({ ...ore, id: 20, name: 'gold_ore', harvestLevel: 2, mapColor: '#b9a55e' });
  r.register({ ...ore, id: 21, name: 'diamond_ore', harvestLevel: 2, drops: [{ item: 'diamond' }], mapColor: '#7fbfbf' });
  r.register({
    id: 22, name: 'sandstone', hardness: 0.8, tool: P, requiresTool: true,
    textures: { side: 'sandstone_side', top: 'sandstone_top', bottom: 'sandstone_bottom' }, mapColor: '#d8cb96',
  });
  r.register({
    id: 23, name: 'crafting_table', hardness: 2.5, tool: A, sound: SoundType.WOOD, interaction: 'crafting',
    textures: { top: 'crafting_table_top', bottom: 'planks', side: 'crafting_table_side', north: 'crafting_table_front', south: 'crafting_table_front' },
    mapColor: '#8f6b3d',
  });

  // Furnaces: 4 facings × lit/unlit. The facing is the side the front texture is on.
  const facings = [
    ['north', 24, 28],
    ['south', 25, 29],
    ['east', 26, 30],
    ['west', 27, 31],
  ];
  for (const [facing, id, litId] of facings) {
    const base = {
      hardness: 3.5, tool: P, requiresTool: true, interaction: 'furnace', mapColor: '#6e6e6e', placement: 'facing',
      textures: { side: 'furnace_side', top: 'furnace_top', bottom: 'furnace_top' },
    };
    r.register({
      ...base, id, name: facing === 'north' ? 'furnace' : `furnace_${facing}`,
      variantOf: facing === 'north' ? undefined : 'furnace',
      textures: { ...base.textures, [facing]: 'furnace_front' },
      variantData: { facing, lit: false },
    });
    r.register({
      ...base, id: litId, name: `lit_furnace_${facing}`, variantOf: 'furnace', lightEmission: 13,
      textures: { ...base.textures, [facing]: 'furnace_front_lit' },
      variantData: { facing, lit: true },
    });
  }

  // Torches: standing plus four wall-mounted variants (aux = lean direction).
  const torch = {
    shape: Shape.TORCH, layer: RenderLayer.CUTOUT, solid: false, collision: null, hardness: 0, lightEmission: 14,
    sound: SoundType.WOOD, textures: { all: 'torch' }, support: 'attached', placement: 'torch', mapColor: '#ffd65c',
  };
  r.register({ ...torch, id: 32, name: 'torch', aux: 0, selection: [0.4, 0, 0.4, 0.6, 0.6, 0.6], variantData: { wall: null } });
  r.register({ ...torch, id: 33, name: 'wall_torch_east', variantOf: 'torch', aux: 1, selection: [0, 0.2, 0.35, 0.3, 0.8, 0.65], variantData: { wall: 'west' } });
  r.register({ ...torch, id: 34, name: 'wall_torch_west', variantOf: 'torch', aux: 2, selection: [0.7, 0.2, 0.35, 1, 0.8, 0.65], variantData: { wall: 'east' } });
  r.register({ ...torch, id: 35, name: 'wall_torch_south', variantOf: 'torch', aux: 3, selection: [0.35, 0.2, 0, 0.65, 0.8, 0.3], variantData: { wall: 'north' } });
  r.register({ ...torch, id: 36, name: 'wall_torch_north', variantOf: 'torch', aux: 4, selection: [0.35, 0.2, 0.7, 0.65, 0.8, 1], variantData: { wall: 'south' } });

  const plant = {
    shape: Shape.CROSS, layer: RenderLayer.CUTOUT, solid: false, collision: null, hardness: 0, replaceable: false,
    sound: SoundType.GRASS, support: 'soil', selection: [0.15, 0, 0.15, 0.85, 0.8, 0.85],
  };
  r.register({ ...plant, id: 37, name: 'tall_grass', replaceable: true, tint: Tint.GRASS, drops: [], mapColor: '#5c9c34' });
  r.register({ ...plant, id: 38, name: 'dandelion', mapColor: '#f5d020', selection: [0.3, 0, 0.3, 0.7, 0.6, 0.7] });
  r.register({ ...plant, id: 39, name: 'poppy', mapColor: '#d02020', selection: [0.3, 0, 0.3, 0.7, 0.6, 0.7] });
  r.register({ ...plant, id: 40, name: 'bluebell', mapColor: '#4a6bff', selection: [0.3, 0, 0.3, 0.7, 0.6, 0.7] });
  r.register({
    id: 41, name: 'cactus', shape: Shape.CACTUS, layer: RenderLayer.CUTOUT, opaque: false, hardness: 0.4,
    sound: SoundType.CLOTH, support: 'sand', collision: [1 / 16, 0, 1 / 16, 15 / 16, 15 / 16, 15 / 16],
    selection: [1 / 16, 0, 1 / 16, 15 / 16, 1, 15 / 16],
    textures: { side: 'cactus_side', top: 'cactus_top', bottom: 'cactus_bottom' }, mapColor: '#1f7a2a',
  });
  r.register({ ...plant, id: 42, name: 'dead_bush', support: 'sand', replaceable: true, drops: [{ item: 'stick', min: 0, max: 2 }], mapColor: '#94703e' });
  r.register({ id: 43, name: 'clay', hardness: 0.6, tool: S, sound: SoundType.GRAVEL, mapColor: '#9fa4b1' });
  r.register({ id: 44, name: 'mossy_cobblestone', hardness: 2, tool: P, requiresTool: true, mapColor: '#6b7a5a' });
  r.register({ id: 45, name: 'white_wool', displayName: 'Wool', hardness: 0.8, sound: SoundType.CLOTH, textures: { all: 'wool' }, mapColor: '#e9ecec' });
  r.register({ id: 46, name: 'glow_crystal', displayName: 'Glow Crystal', hardness: 0.3, sound: SoundType.GLASS, lightEmission: 15, mapColor: '#ffd98a' });
  r.register({ id: 47, name: 'stone_bricks', hardness: 1.5, tool: P, requiresTool: true, mapColor: '#7a7a7a' });
  r.register({ id: 48, name: 'iron_block', displayName: 'Block of Iron', hardness: 5, tool: P, requiresTool: true, harvestLevel: 1, mapColor: '#d8d8d8' });
  r.register({ id: 49, name: 'gold_block', displayName: 'Block of Gold', hardness: 3, tool: P, requiresTool: true, harvestLevel: 2, mapColor: '#f5d74a' });
  r.register({ id: 50, name: 'diamond_block', displayName: 'Block of Diamond', hardness: 5, tool: P, requiresTool: true, harvestLevel: 2, mapColor: '#62e3dc' });
  r.register({ id: 51, name: 'bricks', hardness: 2, tool: P, requiresTool: true, mapColor: '#96503e' });
}

/**
 * Names of textures that are purely overlays (block breaking cracks). They are
 * appended to the texture array after all block textures.
 */
export const DESTROY_STAGES = 10;

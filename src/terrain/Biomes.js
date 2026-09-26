import { BlockIds } from '../blocks/index.js';

/**
 * Biome definitions. Biomes only control surface materials, vegetation and
 * precipitation; terrain height comes from continuous climate noise so
 * transitions between biomes are always smooth.
 * @module terrain/Biomes
 */

/**
 * @typedef {object} Biome
 * @property {number} id
 * @property {string} name
 * @property {string} displayName
 * @property {number} top surface block
 * @property {number} filler block beneath the surface
 * @property {number} fillerDepth
 * @property {number} underwater surface block when submerged
 * @property {number} treeChance probability of a tree per 5×5 cell
 * @property {string} treeType oak | pine | mixed
 * @property {number} grass tall grass probability per column
 * @property {number} flowers flower probability per column
 * @property {number} cactus cactus probability per column
 * @property {number} deadBush dead bush probability per column
 * @property {number} rocks boulder probability per 12×12 cell
 * @property {'rain'|'snow'|'none'} precipitation
 * @property {boolean} frozen freeze exposed water surfaces
 */

const B = BlockIds;

/** @type {Biome[]} */
export const BIOMES = [];

/**
 * @param {Partial<Biome> & {name: string, displayName: string}} spec
 * @returns {Biome}
 */
function biome(spec) {
  const b = {
    id: BIOMES.length,
    top: B.grass_block,
    filler: B.dirt,
    fillerDepth: 3,
    underwater: B.sand,
    treeChance: 0,
    treeType: 'oak',
    grass: 0,
    flowers: 0,
    cactus: 0,
    deadBush: 0,
    rocks: 0,
    precipitation: 'rain',
    frozen: false,
    ...spec,
  };
  BIOMES.push(b);
  return b;
}

export const Biome = Object.freeze({
  OCEAN: biome({ name: 'ocean', displayName: 'Ocean', top: B.sand, filler: B.sand, underwater: B.sand }),
  DEEP_OCEAN: biome({ name: 'deep_ocean', displayName: 'Deep Ocean', top: B.gravel, filler: B.gravel, underwater: B.gravel }),
  FROZEN_OCEAN: biome({ name: 'frozen_ocean', displayName: 'Frozen Ocean', top: B.gravel, filler: B.dirt, underwater: B.gravel, precipitation: 'snow', frozen: true }),
  RIVER: biome({ name: 'river', displayName: 'River', top: B.sand, filler: B.dirt, underwater: B.sand, grass: 0.05 }),
  FROZEN_RIVER: biome({ name: 'frozen_river', displayName: 'Frozen River', top: B.sand, filler: B.dirt, underwater: B.gravel, precipitation: 'snow', frozen: true }),
  BEACH: biome({ name: 'beach', displayName: 'Beach', top: B.sand, filler: B.sand, fillerDepth: 4, underwater: B.sand }),
  SNOWY_BEACH: biome({ name: 'snowy_beach', displayName: 'Snowy Beach', top: B.sand, filler: B.sand, underwater: B.gravel, precipitation: 'snow', frozen: true }),
  STONE_SHORE: biome({ name: 'stone_shore', displayName: 'Stone Shore', top: B.stone, filler: B.stone, underwater: B.gravel }),
  PLAINS: biome({ name: 'plains', displayName: 'Plains', treeChance: 0.035, grass: 0.28, flowers: 0.022, rocks: 0.04 }),
  FOREST: biome({ name: 'forest', displayName: 'Forest', treeChance: 0.8, treeType: 'mixed', grass: 0.14, flowers: 0.012, rocks: 0.03 }),
  DESERT: biome({ name: 'desert', displayName: 'Desert', top: B.sand, filler: B.sand, fillerDepth: 4, underwater: B.sand, cactus: 0.005, deadBush: 0.008, precipitation: 'none' }),
  MOUNTAINS: biome({ name: 'mountains', displayName: 'Mountains', treeChance: 0.08, treeType: 'pine', grass: 0.06, flowers: 0.004, rocks: 0.18, underwater: B.gravel }),
  SNOWY_PLAINS: biome({ name: 'snowy_plains', displayName: 'Snowy Tundra', top: B.snowy_grass_block, treeChance: 0.03, treeType: 'pine', rocks: 0.05, precipitation: 'snow', frozen: true, underwater: B.gravel }),
  SNOWY_FOREST: biome({ name: 'snowy_forest', displayName: 'Snowy Taiga', top: B.snowy_grass_block, treeChance: 0.6, treeType: 'pine', rocks: 0.04, precipitation: 'snow', frozen: true, underwater: B.gravel }),
  HILLS: biome({ name: 'hills', displayName: 'Hills', treeChance: 0.18, treeType: 'mixed', grass: 0.2, flowers: 0.01, rocks: 0.12 }),
  VALLEY: biome({ name: 'valley', displayName: 'Valley', treeChance: 0.08, grass: 0.42, flowers: 0.06, rocks: 0.02 }),
});

/**
 * @param {number} id
 * @returns {Biome}
 */
export function getBiome(id) {
  return BIOMES[id] ?? Biome.PLAINS;
}

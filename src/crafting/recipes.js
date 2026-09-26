import { RecipeRegistry } from './RecipeRegistry.js';

/**
 * All crafting and smelting recipes.
 * @module crafting/recipes
 */

export const recipes = new RecipeRegistry();

recipes.shapeless(['oak_log'], 'oak_planks', 4);
recipes.shaped(['#', '#'], { '#': 'oak_planks' }, 'stick', 4);
recipes.shaped(['##', '##'], { '#': 'oak_planks' }, 'crafting_table');
recipes.shaped(['C', 'S'], { C: 'coal', S: 'stick' }, 'torch', 4);
recipes.shaped(['C', 'S'], { C: 'charcoal', S: 'stick' }, 'torch', 4);
recipes.shaped(['###', '# #', '###'], { '#': 'cobblestone' }, 'furnace');
recipes.shaped(['##', '##'], { '#': 'stone' }, 'stone_bricks', 4);
recipes.shaped(['##', '##'], { '#': 'sand' }, 'sandstone');
recipes.shaped(['###', '###', '###'], { '#': 'coal' }, 'glow_crystal');

const materials = {
  wooden: 'oak_planks',
  stone: 'cobblestone',
  iron: 'iron_ingot',
  diamond: 'diamond',
};
for (const [tier, material] of Object.entries(materials)) {
  const key = { X: material, '#': 'stick' };
  recipes.shaped(['XXX', ' # ', ' # '], key, `${tier}_pickaxe`);
  recipes.shaped(['XX', 'X#', ' #'], key, `${tier}_axe`);
  recipes.shaped(['X', '#', '#'], key, `${tier}_shovel`);
  recipes.shaped(['X', 'X', '#'], key, `${tier}_sword`);
}

for (const [block, ingot] of [['iron_block', 'iron_ingot'], ['gold_block', 'gold_ingot'], ['diamond_block', 'diamond']]) {
  recipes.shaped(['###', '###', '###'], { '#': ingot }, block);
  recipes.shapeless([block], ingot, 9);
}

/**
 * Furnace recipes: input item name → output item name.
 * @type {Record<string, string>}
 */
export const SMELTING = {
  iron_ore: 'iron_ingot',
  gold_ore: 'gold_ingot',
  diamond_ore: 'diamond',
  coal_ore: 'coal',
  sand: 'glass',
  cobblestone: 'stone',
  clay: 'bricks',
  oak_log: 'charcoal',
  raw_beef: 'cooked_beef',
  raw_porkchop: 'cooked_porkchop',
  raw_mutton: 'cooked_mutton',
};

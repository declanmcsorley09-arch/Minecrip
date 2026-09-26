/**
 * Declarative item list. Ids are explicit (≥ 256) so saves stay compatible.
 * @module items/definitions
 */

/** Tool material tiers. */
export const TOOL_TIERS = Object.freeze({
  wooden: { tier: 0, speed: 2, durability: 59, bonus: 0, fuel: 10 },
  stone: { tier: 1, speed: 4, durability: 131, bonus: 1, fuel: 0 },
  iron: { tier: 2, speed: 6, durability: 250, bonus: 2, fuel: 0 },
  diamond: { tier: 3, speed: 8, durability: 1561, bonus: 3, fuel: 0 },
});

/** Base attack damage of each tool type before the tier bonus. */
const BASE_DAMAGE = { sword: 4, axe: 3, pickaxe: 2, shovel: 1.5 };

/** Furnace burn time (seconds) of block items. */
export const BLOCK_FUEL = {
  oak_planks: 15,
  oak_log: 15,
  crafting_table: 15,
};

/**
 * Registers every non-block item.
 * @param {import('./ItemRegistry.js').ItemRegistry} r
 */
export function registerDefaultItems(r) {
  r.register({ id: 256, name: 'stick', fuel: 5 });
  r.register({ id: 257, name: 'coal', fuel: 80 });
  r.register({ id: 258, name: 'charcoal', fuel: 80 });
  r.register({ id: 259, name: 'iron_ingot' });
  r.register({ id: 260, name: 'gold_ingot' });
  r.register({ id: 261, name: 'diamond' });
  r.register({ id: 262, name: 'leather' });
  r.register({ id: 263, name: 'bone' });
  r.register({ id: 264, name: 'arrow' });
  r.register({ id: 265, name: 'rotten_flesh', food: { heal: 2 } });
  r.register({ id: 266, name: 'apple', food: { heal: 4 } });
  r.register({ id: 267, name: 'raw_beef', food: { heal: 3 } });
  r.register({ id: 268, name: 'cooked_beef', displayName: 'Steak', food: { heal: 8 } });
  r.register({ id: 269, name: 'raw_porkchop', food: { heal: 3 } });
  r.register({ id: 270, name: 'cooked_porkchop', food: { heal: 8 } });
  r.register({ id: 271, name: 'raw_mutton', food: { heal: 2 } });
  r.register({ id: 272, name: 'cooked_mutton', food: { heal: 6 } });

  let id = 300;
  for (const [material, info] of Object.entries(TOOL_TIERS)) {
    for (const type of ['pickaxe', 'axe', 'shovel', 'sword']) {
      r.register({
        id: id++,
        name: `${material}_${type}`,
        icon: `tool:${type}:${material}`,
        fuel: info.fuel,
        tool: {
          type,
          tier: info.tier,
          speed: type === 'sword' ? 1.5 : info.speed,
          durability: info.durability,
          damage: BASE_DAMAGE[type] + info.bonus,
        },
      });
    }
  }
}

import { ItemRegistry } from './ItemRegistry.js';
import { registerDefaultItems, BLOCK_FUEL } from './definitions.js';

/**
 * Process-wide item registry singleton.
 * @module items
 */

export const itemRegistry = new ItemRegistry();
itemRegistry.registerBlockItems(BLOCK_FUEL);
registerDefaultItems(itemRegistry);

/** Convenience name → id map (e.g. `ItemIds.stick`). */
export const ItemIds = itemRegistry.ids;

export { ItemRegistry, FIRST_ITEM_ID } from './ItemRegistry.js';
export { TOOL_TIERS } from './definitions.js';

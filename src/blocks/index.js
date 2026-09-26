import { BlockRegistry } from './BlockRegistry.js';
import { registerDefaultBlocks, DESTROY_STAGES } from './definitions.js';

/**
 * Process-wide block registry singleton. Importing this module in any context
 * (main thread, worker, server) yields identical ids and lookup tables.
 * @module blocks
 */

export const blockRegistry = new BlockRegistry();
registerDefaultBlocks(blockRegistry);

/** Texture layers of the 10 block-breaking crack stages. */
export const DESTROY_TEXTURES = [];
for (let i = 0; i < DESTROY_STAGES; i++) {
  DESTROY_TEXTURES.push(blockRegistry.registerTexture(`destroy_${i}`));
}

/** Convenience name → id map (e.g. `BlockIds.stone`). */
export const BlockIds = blockRegistry.ids;

export * from './BlockShapes.js';
export { BlockRegistry } from './BlockRegistry.js';

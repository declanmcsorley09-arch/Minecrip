import { blockRegistry } from '../blocks/index.js';
import { itemRegistry } from './index.js';

/**
 * Mining rules: break times, harvestability and drop rolls.
 * @module items/Mining
 */

/**
 * Returns the tool info of an item or null.
 * @param {number} itemId
 * @returns {import('./ItemRegistry.js').ToolInfo|null}
 */
function toolOf(itemId) {
  const item = itemId ? itemRegistry.get(itemId) : null;
  return item ? item.tool : null;
}

/**
 * Whether mining `blockId` with `itemId` yields drops.
 * @param {number} blockId
 * @param {number} itemId held item (0 = hand)
 * @returns {boolean}
 */
export function canHarvest(blockId, itemId) {
  const block = blockRegistry.get(blockId);
  if (!block.requiresTool) return true;
  const tool = toolOf(itemId);
  return !!tool && tool.type === block.tool && tool.tier >= block.harvestLevel;
}

/**
 * Mining speed multiplier of an item against a block.
 * @param {number} blockId
 * @param {number} itemId
 * @returns {number}
 */
export function miningSpeed(blockId, itemId) {
  const block = blockRegistry.get(blockId);
  const tool = toolOf(itemId);
  if (tool && tool.type === block.tool) return tool.speed;
  return 1;
}

/**
 * Time in seconds needed to break a block in survival mode.
 * @param {number} blockId
 * @param {number} itemId
 * @returns {number} seconds; Infinity for unbreakable blocks, 0 for instant
 */
export function getBreakTime(blockId, itemId) {
  const block = blockRegistry.get(blockId);
  if (block.hardness < 0) return Infinity;
  if (block.hardness === 0) return 0;
  const perTick = miningSpeed(blockId, itemId) / block.hardness / (canHarvest(blockId, itemId) ? 30 : 100);
  if (perTick >= 1) return 0;
  return Math.ceil(1 / perTick) / 20;
}

/**
 * Rolls the item drops for a broken block.
 * @param {number} blockId
 * @param {number} itemId held item used to mine
 * @param {() => number} random uniform [0,1) generator
 * @returns {{id:number, count:number}[]}
 */
export function rollDrops(blockId, itemId, random = Math.random) {
  if (!canHarvest(blockId, itemId)) return [];
  const block = blockRegistry.get(blockId);
  if (!block.drops) {
    const item = itemRegistry.getByName(block.itemName);
    return item ? [{ id: item.id, count: 1 }] : [];
  }
  const result = [];
  for (const drop of block.drops) {
    if (drop.chance !== undefined && random() >= drop.chance) continue;
    const min = drop.min ?? 1;
    const max = drop.max ?? min;
    const count = min + Math.floor(random() * (max - min + 1));
    if (count <= 0) continue;
    const item = itemRegistry.getByName(drop.item);
    if (item) result.push({ id: item.id, count });
  }
  return result;
}

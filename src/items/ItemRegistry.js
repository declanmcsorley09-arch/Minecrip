import { blockRegistry } from '../blocks/index.js';

/**
 * Registry of item types. Block items share their id with the block
 * (1..255); non-block items (tools, materials, food) use ids ≥ 256.
 * @module items/ItemRegistry
 */

/** First id available to non-block items. */
export const FIRST_ITEM_ID = 256;

/**
 * @typedef {object} ToolInfo
 * @property {string} type pickaxe | axe | shovel | sword
 * @property {number} tier 0 wood, 1 stone, 2 iron, 3 diamond
 * @property {number} speed mining speed multiplier on matching blocks
 * @property {number} durability uses before breaking
 * @property {number} damage attack damage (health points)
 */

/**
 * @typedef {object} ItemDefinition
 * @property {number} id
 * @property {string} name
 * @property {string} displayName
 * @property {number} maxStack
 * @property {number} blockId block placed by this item, 0 if none
 * @property {ToolInfo|null} tool
 * @property {{heal:number}|null} food
 * @property {number} fuel furnace burn time in seconds (0 = not fuel)
 * @property {string} icon icon painter name
 * @property {string} category blocks | tools | materials | food
 */

export class ItemRegistry {
  constructor() {
    /** @type {Map<number, ItemDefinition>} */
    this.byId = new Map();
    /** @type {Map<string, ItemDefinition>} */
    this.byName = new Map();
    /** @type {Record<string, number>} */
    this.ids = Object.create(null);
    this.nextId = FIRST_ITEM_ID;
  }

  /**
   * Registers an item.
   * @param {Partial<ItemDefinition> & {name: string}} spec
   * @returns {ItemDefinition}
   */
  register(spec) {
    const id = spec.id ?? this.nextId++;
    if (this.byId.has(id)) throw new Error(`Item id ${id} already registered`);
    if (this.byName.has(spec.name)) throw new Error(`Item ${spec.name} already registered`);
    /** @type {ItemDefinition} */
    const def = {
      id,
      name: spec.name,
      displayName: spec.displayName ?? spec.name.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '),
      maxStack: spec.maxStack ?? (spec.tool ? 1 : 64),
      blockId: spec.blockId ?? 0,
      tool: spec.tool ?? null,
      food: spec.food ?? null,
      fuel: spec.fuel ?? 0,
      icon: spec.icon ?? spec.name,
      category: spec.category ?? (spec.tool ? 'tools' : spec.food ? 'food' : 'materials'),
    };
    this.byId.set(id, def);
    this.byName.set(def.name, def);
    this.ids[def.name] = id;
    return def;
  }

  /**
   * Registers one item per block that exposes an item form.
   * @param {Record<string, number>} fuelByBlock burn seconds keyed by block name
   */
  registerBlockItems(fuelByBlock) {
    for (const block of blockRegistry.all()) {
      if (block.id === 0 || !block.hasItem) continue;
      this.register({
        id: block.id,
        name: block.name,
        displayName: block.displayName,
        blockId: block.id,
        maxStack: 64,
        fuel: fuelByBlock[block.name] ?? 0,
        icon: `block:${block.name}`,
        category: 'blocks',
      });
    }
  }

  /**
   * @param {number} id
   * @returns {ItemDefinition|undefined}
   */
  get(id) {
    return this.byId.get(id);
  }

  /**
   * @param {string} name
   * @returns {ItemDefinition|undefined}
   */
  getByName(name) {
    return this.byName.get(name);
  }

  /**
   * All items, block items first then others, in id order.
   * @returns {ItemDefinition[]}
   */
  all() {
    return [...this.byId.values()].sort((a, b) => a.id - b.id);
  }

  /**
   * Resolves the item id obtained from a block (pick-block / drops).
   * @param {number} blockId
   * @returns {number} item id or 0
   */
  itemForBlock(blockId) {
    const def = blockRegistry.get(blockId);
    const item = this.byName.get(def.itemName);
    return item ? item.id : 0;
  }
}

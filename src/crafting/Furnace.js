import { itemRegistry } from '../items/index.js';
import { ItemStack } from '../inventory/ItemStack.js';
import { SMELTING } from './recipes.js';

/**
 * Furnace block-entity logic: consumes fuel, smelts one input every
 * {@link COOK_TIME} seconds and stacks the result in the output slot.
 * Pure logic, ticked by the authoritative server.
 */

/** Seconds needed to smelt one item. */
export const COOK_TIME = 10;

/** Input item id → output item id. */
const SMELT_BY_ID = new Map(
  Object.entries(SMELTING).map(([input, output]) => [itemRegistry.getByName(input).id, itemRegistry.getByName(output).id]),
);

/**
 * Smelting result of an item.
 * @param {number} itemId
 * @returns {number} output item id or 0
 */
export function smeltResult(itemId) {
  return SMELT_BY_ID.get(itemId) ?? 0;
}

/**
 * Burn time of an item in seconds.
 * @param {number} itemId
 * @returns {number}
 */
export function fuelValue(itemId) {
  return itemRegistry.get(itemId)?.fuel ?? 0;
}

export class FurnaceState {
  constructor() {
    this.type = 'furnace';
    /** @type {ItemStack|null} */
    this.input = null;
    /** @type {ItemStack|null} */
    this.fuel = null;
    /** @type {ItemStack|null} */
    this.output = null;
    this.burnTime = 0;
    this.burnTotal = 0;
    this.cookTime = 0;
  }

  /** Whether fuel is currently burning. */
  get lit() {
    return this.burnTime > 0;
  }

  /**
   * Whether the current input can be smelted into the output slot.
   * @returns {boolean}
   */
  canSmelt() {
    if (!this.input) return false;
    const out = smeltResult(this.input.id);
    if (!out) return false;
    if (!this.output) return true;
    return this.output.id === out && this.output.count < this.output.maxStack;
  }

  /**
   * Advances the furnace.
   * @param {number} dt seconds
   * @returns {boolean} true if any slot or progress visibly changed
   */
  tick(dt) {
    let changed = false;
    const wasLit = this.lit;
    if (this.burnTime > 0) this.burnTime = Math.max(0, this.burnTime - dt);
    const smeltable = this.canSmelt();
    if (this.burnTime <= 0 && smeltable && this.fuel && fuelValue(this.fuel.id) > 0) {
      this.burnTotal = fuelValue(this.fuel.id);
      this.burnTime = this.burnTotal;
      this.fuel.count--;
      if (this.fuel.count <= 0) this.fuel = null;
      changed = true;
    }
    if (this.burnTime > 0 && smeltable) {
      this.cookTime += dt;
      if (this.cookTime >= COOK_TIME) {
        this.cookTime = 0;
        const out = smeltResult(this.input.id);
        this.input.count--;
        if (this.input.count <= 0) this.input = null;
        if (this.output) this.output.count++;
        else this.output = new ItemStack(out, 1);
        changed = true;
      }
    } else if (this.cookTime > 0) {
      this.cookTime = Math.max(0, this.cookTime - dt * 2);
    }
    return changed || wasLit !== this.lit;
  }

  /** @returns {object} */
  toJSON() {
    return {
      type: 'furnace',
      input: this.input?.toJSON() ?? null,
      fuel: this.fuel?.toJSON() ?? null,
      output: this.output?.toJSON() ?? null,
      burnTime: this.burnTime,
      burnTotal: this.burnTotal,
      cookTime: this.cookTime,
    };
  }

  /**
   * @param {object} data
   * @returns {FurnaceState}
   */
  static fromJSON(data) {
    const f = new FurnaceState();
    f.input = ItemStack.fromJSON(data.input);
    f.fuel = ItemStack.fromJSON(data.fuel);
    f.output = ItemStack.fromJSON(data.output);
    f.burnTime = data.burnTime ?? 0;
    f.burnTotal = data.burnTotal ?? 0;
    f.cookTime = data.cookTime ?? 0;
    return f;
  }
}

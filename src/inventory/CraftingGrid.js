import { recipes } from '../crafting/recipes.js';
import { isEmpty } from './ItemStack.js';

/**
 * An n×n crafting grid with a live result slot.
 */
export class CraftingGrid {
  /**
   * @param {number} size 2 (inventory) or 3 (crafting table)
   */
  constructor(size) {
    this.size = size;
    /** @type {(import('./ItemStack.js').ItemStack|null)[]} */
    this.slots = new Array(size * size).fill(null);
    this.result = null;
  }

  /** Recomputes the result after a change. */
  update() {
    this.result = recipes.match(this.slots, this.size);
  }

  /**
   * Slot adapters for the grid cells.
   * @returns {import('./SlotActions.js').Slot[]}
   */
  inputSlots() {
    return this.slots.map((_, i) => ({
      get: () => this.slots[i],
      set: (s) => {
        this.slots[i] = isEmpty(s) ? null : s;
        this.update();
      },
    }));
  }

  /**
   * Slot adapter for the result.
   * @returns {import('./SlotActions.js').Slot}
   */
  outputSlot() {
    return {
      output: true,
      get: () => this.result,
      set: () => {},
      take: () => {
        if (!this.result) return null;
        const out = this.result.clone();
        recipes.consume(this.slots);
        this.update();
        return out;
      },
    };
  }

  /**
   * Removes and returns every remaining ingredient (when the UI closes).
   * @returns {import('./ItemStack.js').ItemStack[]}
   */
  drain() {
    const items = this.slots.filter(Boolean);
    this.slots.fill(null);
    this.result = null;
    return items;
  }
}

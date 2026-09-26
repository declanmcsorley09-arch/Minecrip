import { itemRegistry } from '../items/index.js';
import { ItemStack } from '../inventory/ItemStack.js';

/**
 * Crafting recipe registry and matcher. Supports shaped recipes (with
 * automatic horizontal mirroring, placed anywhere in the grid) and
 * shapeless recipes.
 */

/**
 * @typedef {object} Recipe
 * @property {'shaped'|'shapeless'} type
 * @property {number} width shaped only
 * @property {number} height shaped only
 * @property {(number|0)[]} cells shaped only: item id per cell (0 = empty)
 * @property {number[]} ingredients shapeless only
 * @property {number} result item id
 * @property {number} count result count
 */

export class RecipeRegistry {
  constructor() {
    /** @type {Recipe[]} */
    this.recipes = [];
  }

  /**
   * Resolves an item name, throwing for unknown items so typos surface early.
   * @private
   */
  id(name) {
    const def = itemRegistry.getByName(name);
    if (!def) throw new Error(`Unknown item in recipe: ${name}`);
    return def.id;
  }

  /**
   * Adds a shaped recipe.
   * @param {string[]} pattern rows of characters; space = empty
   * @param {Record<string, string>} key character → item name
   * @param {string} result item name
   * @param {number} [count=1]
   */
  shaped(pattern, key, result, count = 1) {
    const height = pattern.length;
    const width = Math.max(...pattern.map((r) => r.length));
    const cells = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const ch = pattern[y][x] ?? ' ';
        cells.push(ch === ' ' ? 0 : this.id(key[ch]));
      }
    }
    this.recipes.push({ type: 'shaped', width, height, cells, ingredients: [], result: this.id(result), count });
  }

  /**
   * Adds a shapeless recipe.
   * @param {string[]} ingredients item names
   * @param {string} result
   * @param {number} [count=1]
   */
  shapeless(ingredients, result, count = 1) {
    this.recipes.push({ type: 'shapeless', width: 0, height: 0, cells: [], ingredients: ingredients.map((n) => this.id(n)), result: this.id(result), count });
  }

  /**
   * Finds the result for a crafting grid.
   * @param {(ItemStack|null)[]} grid row-major slots
   * @param {number} size grid edge length (2 or 3)
   * @returns {ItemStack|null}
   */
  match(grid, size) {
    let minX = size;
    let minY = size;
    let maxX = -1;
    let maxY = -1;
    const items = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const s = grid[y * size + x];
        if (!s) continue;
        items.push(s.id);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    if (items.length === 0) return null;
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    for (const r of this.recipes) {
      if (r.type === 'shapeless') {
        if (r.ingredients.length !== items.length) continue;
        const pool = [...items].sort((a, b) => a - b);
        const need = [...r.ingredients].sort((a, b) => a - b);
        if (pool.every((v, i) => v === need[i])) return new ItemStack(r.result, r.count);
        continue;
      }
      if (r.width !== w || r.height !== h) continue;
      for (const mirror of [false, true]) {
        let ok = true;
        for (let y = 0; y < h && ok; y++) {
          for (let x = 0; x < w && ok; x++) {
            const s = grid[(minY + y) * size + (minX + x)];
            const want = r.cells[y * w + (mirror ? w - 1 - x : x)];
            const have = s ? s.id : 0;
            if (want !== have) ok = false;
          }
        }
        if (ok) return new ItemStack(r.result, r.count);
      }
    }
    return null;
  }

  /**
   * Consumes one item from every non-empty grid slot (after crafting).
   * @param {(ItemStack|null)[]} grid mutated
   */
  consume(grid) {
    for (let i = 0; i < grid.length; i++) {
      const s = grid[i];
      if (!s) continue;
      s.count--;
      if (s.count <= 0) grid[i] = null;
    }
  }
}

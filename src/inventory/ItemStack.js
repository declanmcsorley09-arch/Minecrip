import { itemRegistry } from '../items/index.js';

/**
 * A stack of identical items. Tools track `damage` (uses consumed).
 */
export class ItemStack {
  /**
   * @param {number} id item id
   * @param {number} [count=1]
   * @param {number} [damage=0] durability used (tools)
   */
  constructor(id, count = 1, damage = 0) {
    this.id = id;
    this.count = count;
    this.damage = damage;
  }

  /** @returns {import('../items/ItemRegistry.js').ItemDefinition|undefined} */
  get def() {
    return itemRegistry.get(this.id);
  }

  /** Maximum stack size of this item. */
  get maxStack() {
    const d = this.def;
    return d ? d.maxStack : 64;
  }

  /** Remaining durability fraction for tools (1 = new). */
  get durabilityFraction() {
    const tool = this.def?.tool;
    if (!tool) return 1;
    return Math.max(0, 1 - this.damage / tool.durability);
  }

  /**
   * Whether `other` can merge into this stack.
   * @param {ItemStack|null} other
   * @returns {boolean}
   */
  canStackWith(other) {
    return !!other && other.id === this.id && this.maxStack > 1 && this.damage === other.damage;
  }

  /** @returns {ItemStack} */
  clone() {
    return new ItemStack(this.id, this.count, this.damage);
  }

  /**
   * Splits `n` items off into a new stack.
   * @param {number} n
   * @returns {ItemStack}
   */
  split(n) {
    const take = Math.min(n, this.count);
    this.count -= take;
    return new ItemStack(this.id, take, this.damage);
  }

  /** @returns {{id:number, count:number, damage:number}} */
  toJSON() {
    return { id: this.id, count: this.count, damage: this.damage };
  }

  /**
   * @param {{id:number, count:number, damage?:number}|null} data
   * @returns {ItemStack|null}
   */
  static fromJSON(data) {
    if (!data || !itemRegistry.get(data.id) || data.count <= 0) return null;
    return new ItemStack(data.id, data.count, data.damage ?? 0);
  }
}

/**
 * Whether a slot value is empty.
 * @param {ItemStack|null|undefined} stack
 * @returns {boolean}
 */
export function isEmpty(stack) {
  return !stack || stack.count <= 0;
}

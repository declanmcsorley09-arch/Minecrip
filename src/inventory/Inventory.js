import { EventEmitter } from '../utils/EventEmitter.js';
import { ItemStack, isEmpty } from './ItemStack.js';

/**
 * Fixed-size slot container. Emits `change` after every mutation.
 */
export class Inventory extends EventEmitter {
  /**
   * @param {number} size number of slots
   */
  constructor(size) {
    super();
    /** @type {(ItemStack|null)[]} */
    this.slots = new Array(size).fill(null);
  }

  /** @returns {number} */
  get size() {
    return this.slots.length;
  }

  /**
   * @param {number} i
   * @returns {ItemStack|null}
   */
  get(i) {
    return this.slots[i] ?? null;
  }

  /**
   * @param {number} i
   * @param {ItemStack|null} stack
   */
  set(i, stack) {
    this.slots[i] = isEmpty(stack) ? null : stack;
    this.emit('change', i);
  }

  /** Empties every slot. */
  clear() {
    this.slots.fill(null);
    this.emit('change', -1);
  }

  /**
   * Order in which `add` fills slots (overridden by the player inventory to
   * prefer the hotbar).
   * @returns {number[]}
   */
  fillOrder() {
    return this.slots.map((_, i) => i);
  }

  /**
   * How many of an item could be inserted.
   * @param {number} id
   * @param {number} [damage=0]
   * @returns {number}
   */
  capacityFor(id, damage = 0) {
    const probe = new ItemStack(id, 1, damage);
    let cap = 0;
    for (const s of this.slots) {
      if (!s) cap += probe.maxStack;
      else if (s.canStackWith(probe)) cap += s.maxStack - s.count;
    }
    return cap;
  }

  /**
   * Inserts a stack, merging with existing stacks first.
   * @param {ItemStack} stack (not mutated)
   * @returns {number} items that did not fit
   */
  add(stack) {
    let remaining = stack.count;
    const order = this.fillOrder();
    for (const i of order) {
      if (remaining <= 0) break;
      const s = this.slots[i];
      if (s && s.canStackWith(stack) && s.count < s.maxStack) {
        const n = Math.min(remaining, s.maxStack - s.count);
        s.count += n;
        remaining -= n;
      }
    }
    for (const i of order) {
      if (remaining <= 0) break;
      if (!this.slots[i]) {
        const n = Math.min(remaining, stack.maxStack);
        this.slots[i] = new ItemStack(stack.id, n, stack.damage);
        remaining -= n;
      }
    }
    if (remaining !== stack.count) this.emit('change', -1);
    return remaining;
  }

  /**
   * Total count of an item.
   * @param {number} id
   * @returns {number}
   */
  count(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  /**
   * Removes up to `count` items of an id.
   * @param {number} id
   * @param {number} count
   * @returns {number} removed amount
   */
  remove(id, count) {
    let left = count;
    for (let i = this.slots.length - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (!s || s.id !== id) continue;
      const n = Math.min(left, s.count);
      s.count -= n;
      left -= n;
      if (s.count <= 0) this.slots[i] = null;
    }
    if (left !== count) this.emit('change', -1);
    return count - left;
  }

  /**
   * Serialises the slots.
   * @returns {(object|null)[]}
   */
  toJSON() {
    return this.slots.map((s) => (s ? s.toJSON() : null));
  }

  /**
   * Restores slots from {@link Inventory#toJSON}.
   * @param {(object|null)[]} data
   */
  fromJSON(data) {
    if (!Array.isArray(data)) return;
    for (let i = 0; i < this.slots.length; i++) this.slots[i] = ItemStack.fromJSON(data[i]);
    this.emit('change', -1);
  }
}

/** Number of hotbar slots. */
export const HOTBAR_SIZE = 9;

/**
 * The player's 36-slot inventory: slots 0-8 are the hotbar, 9-35 the main
 * storage. Pickups fill the hotbar first (natural slot order).
 */
export class PlayerInventory extends Inventory {
  constructor() {
    super(36);
    this.selected = 0;
  }

  /**
   * Stack in the selected hotbar slot.
   * @returns {ItemStack|null}
   */
  get held() {
    return this.slots[this.selected];
  }

  /**
   * Selects a hotbar slot.
   * @param {number} i 0..8
   */
  select(i) {
    const next = ((i % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
    if (next === this.selected) return;
    this.selected = next;
    this.emit('select', next);
  }

  /**
   * Removes one item from the held stack.
   * @returns {ItemStack|null} the consumed single item
   */
  consumeHeld() {
    const s = this.held;
    if (!s) return null;
    const one = s.split(1);
    if (s.count <= 0) this.slots[this.selected] = null;
    this.emit('change', this.selected);
    return one;
  }

  /**
   * Applies tool wear to the held item; breaks it when exhausted.
   * @param {number} [amount=1]
   * @returns {boolean} true if the tool broke
   */
  damageHeld(amount = 1) {
    const s = this.held;
    const tool = s?.def?.tool;
    if (!tool) return false;
    s.damage += amount;
    const broke = s.damage >= tool.durability;
    if (broke) this.slots[this.selected] = null;
    this.emit('change', this.selected);
    return broke;
  }
}

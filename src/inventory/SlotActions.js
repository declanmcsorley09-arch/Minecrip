import { ItemStack, isEmpty } from './ItemStack.js';

/**
 * Container slot interaction rules (left/right click, shift-click,
 * double-click collect, drag distribution), independent of the DOM.
 * @module inventory/SlotActions
 */

/**
 * @typedef {object} Slot
 * @property {() => ItemStack|null} get
 * @property {(stack: ItemStack|null) => void} set
 * @property {(stack: ItemStack) => boolean} [accepts] whether a stack may be placed
 * @property {boolean} [output] take-only slot (crafting / furnace result)
 * @property {() => ItemStack|null} [take] removes the result (consuming ingredients)
 * @property {number} [limit] max items in this slot
 */

/**
 * @typedef {object} Cursor
 * @property {ItemStack|null} stack item held by the mouse
 */

/** @private */
function slotLimit(slot, stack) {
  return Math.min(slot.limit ?? 64, stack.maxStack);
}

/**
 * Handles a click on a slot.
 * @param {Slot} slot
 * @param {Cursor} cursor
 * @param {number} button 0 = left, 2 = right
 */
export function clickSlot(slot, cursor, button) {
  const inSlot = slot.get();
  const held = cursor.stack;

  if (slot.output) {
    if (isEmpty(inSlot)) return;
    if (!held) {
      cursor.stack = slot.take();
    } else if (held.canStackWith(inSlot) && held.count + inSlot.count <= held.maxStack) {
      const taken = slot.take();
      if (taken) held.count += taken.count;
    }
    return;
  }

  if (button === 0) {
    if (!held) {
      if (inSlot) {
        cursor.stack = inSlot;
        slot.set(null);
      }
      return;
    }
    if (slot.accepts && !slot.accepts(held)) return;
    if (!inSlot) {
      const limit = slotLimit(slot, held);
      if (held.count <= limit) {
        slot.set(held);
        cursor.stack = null;
      } else {
        slot.set(held.split(limit));
      }
      return;
    }
    if (inSlot.canStackWith(held)) {
      const room = slotLimit(slot, inSlot) - inSlot.count;
      const n = Math.min(room, held.count);
      inSlot.count += n;
      held.count -= n;
      slot.set(inSlot);
      if (held.count <= 0) cursor.stack = null;
      return;
    }
    slot.set(held);
    cursor.stack = inSlot;
    return;
  }

  // Right click.
  if (!held) {
    if (inSlot) {
      const half = Math.ceil(inSlot.count / 2);
      cursor.stack = inSlot.split(half);
      slot.set(inSlot.count > 0 ? inSlot : null);
    }
    return;
  }
  if (slot.accepts && !slot.accepts(held)) return;
  if (!inSlot) {
    slot.set(held.split(1));
    if (held.count <= 0) cursor.stack = null;
    return;
  }
  if (inSlot.canStackWith(held) && inSlot.count < slotLimit(slot, inSlot)) {
    inSlot.count++;
    held.count--;
    slot.set(inSlot);
    if (held.count <= 0) cursor.stack = null;
    return;
  }
  slot.set(held);
  cursor.stack = inSlot;
}

/**
 * Moves a slot's stack into the first fitting target slots.
 * @param {Slot} slot
 * @param {Slot[]} targets
 * @returns {boolean} true if anything moved
 */
export function shiftClick(slot, targets) {
  if (slot.output) {
    // Craft repeatedly while the result fits.
    let moved = false;
    for (let guard = 0; guard < 64; guard++) {
      const result = slot.get();
      if (isEmpty(result) || !canInsertAll(targets, result)) break;
      const taken = slot.take();
      if (!taken) break;
      insert(targets, taken);
      moved = true;
    }
    return moved;
  }
  const stack = slot.get();
  if (isEmpty(stack)) return false;
  const before = stack.count;
  insert(targets, stack);
  slot.set(stack.count > 0 ? stack : null);
  return stack.count !== before;
}

/**
 * Whether a whole stack fits into the targets.
 * @param {Slot[]} targets
 * @param {ItemStack} stack
 * @returns {boolean}
 */
export function canInsertAll(targets, stack) {
  let room = 0;
  for (const t of targets) {
    if (t.output || (t.accepts && !t.accepts(stack))) continue;
    const s = t.get();
    if (!s) room += slotLimit(t, stack);
    else if (s.canStackWith(stack)) room += slotLimit(t, s) - s.count;
    if (room >= stack.count) return true;
  }
  return false;
}

/**
 * Inserts as much of `stack` as possible (mutates its count).
 * @param {Slot[]} targets
 * @param {ItemStack} stack
 */
export function insert(targets, stack) {
  for (const t of targets) {
    if (stack.count <= 0) return;
    if (t.output || (t.accepts && !t.accepts(stack))) continue;
    const s = t.get();
    if (s && s.canStackWith(stack)) {
      const n = Math.min(slotLimit(t, s) - s.count, stack.count);
      if (n > 0) {
        s.count += n;
        stack.count -= n;
        t.set(s);
      }
    }
  }
  for (const t of targets) {
    if (stack.count <= 0) return;
    if (t.output || (t.accepts && !t.accepts(stack))) continue;
    if (!t.get()) {
      const n = Math.min(slotLimit(t, stack), stack.count);
      t.set(new ItemStack(stack.id, n, stack.damage));
      stack.count -= n;
    }
  }
}

/**
 * Double-click: gathers matching items into the cursor stack.
 * @param {Slot[]} slots
 * @param {Cursor} cursor
 */
export function collectToCursor(slots, cursor) {
  const held = cursor.stack;
  if (!held) return;
  for (const slot of slots) {
    if (held.count >= held.maxStack) break;
    if (slot.output) continue;
    const s = slot.get();
    if (!s || !s.canStackWith(held)) continue;
    const n = Math.min(held.maxStack - held.count, s.count);
    held.count += n;
    s.count -= n;
    slot.set(s.count > 0 ? s : null);
  }
}

/**
 * Drag distribution: left-drag splits the cursor evenly across the slots,
 * right-drag puts one item in each.
 * @param {Slot[]} slots slots dragged over (in order)
 * @param {Cursor} cursor
 * @param {number} button 0 = even split, 2 = one each
 */
export function distribute(slots, cursor, button) {
  const held = cursor.stack;
  if (!held || slots.length === 0) return;
  const valid = slots.filter((s) => {
    if (s.output || (s.accepts && !s.accepts(held))) return false;
    const cur = s.get();
    return !cur || (cur.canStackWith(held) && cur.count < slotLimit(s, cur));
  });
  if (valid.length === 0) return;
  const per = button === 2 ? 1 : Math.max(1, Math.floor(held.count / valid.length));
  for (const s of valid) {
    if (held.count <= 0) break;
    const cur = s.get();
    const limit = slotLimit(s, held);
    const n = Math.min(per, held.count, limit - (cur ? cur.count : 0));
    if (n <= 0) continue;
    if (cur) {
      cur.count += n;
      s.set(cur);
    } else s.set(new ItemStack(held.id, n, held.damage));
    held.count -= n;
  }
  if (held.count <= 0) cursor.stack = null;
}

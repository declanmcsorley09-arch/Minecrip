/**
 * Binary min-heap keyed by a numeric priority. Used by A* pathfinding and the
 * chunk job schedulers.
 * @template T
 */
export class MinHeap {
  constructor() {
    /** @type {T[]} */
    this.items = [];
    /** @type {number[]} */
    this.priorities = [];
  }

  /** @returns {number} */
  get size() {
    return this.items.length;
  }

  /** Removes every entry. */
  clear() {
    this.items.length = 0;
    this.priorities.length = 0;
  }

  /**
   * @param {T} item
   * @param {number} priority lower values pop first
   */
  push(item, priority) {
    const items = this.items;
    const pr = this.priorities;
    let i = items.length;
    items.push(item);
    pr.push(priority);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (pr[parent] <= priority) break;
      items[i] = items[parent];
      pr[i] = pr[parent];
      i = parent;
    }
    items[i] = item;
    pr[i] = priority;
  }

  /**
   * Priority of the smallest entry.
   * @returns {number}
   */
  peekPriority() {
    return this.priorities[0];
  }

  /**
   * Removes and returns the entry with the smallest priority.
   * @returns {T|undefined}
   */
  pop() {
    const items = this.items;
    const pr = this.priorities;
    if (items.length === 0) return undefined;
    const top = items[0];
    const lastItem = items.pop();
    const lastPr = pr.pop();
    const n = items.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        let sp = lastPr;
        if (l < n && pr[l] < sp) {
          smallest = l;
          sp = pr[l];
        }
        if (r < n && pr[r] < sp) {
          smallest = r;
          sp = pr[r];
        }
        if (smallest === i) break;
        items[i] = items[smallest];
        pr[i] = pr[smallest];
        i = smallest;
      }
      items[i] = lastItem;
      pr[i] = lastPr;
    }
    return top;
  }
}

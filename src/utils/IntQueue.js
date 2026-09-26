/**
 * Growable FIFO ring buffer of 32-bit integers. Used by the lighting BFS and
 * other hot loops where allocating an object per entry would thrash the GC.
 * Entries are pushed/popped as tuples of fixed width (`stride`).
 */
export class IntQueue {
  /**
   * @param {number} stride integers per entry
   * @param {number} [initialCapacity=4096] initial entry capacity
   */
  constructor(stride, initialCapacity = 4096) {
    this.stride = stride;
    this.capacity = initialCapacity;
    this.data = new Int32Array(initialCapacity * stride);
    this.head = 0;
    this.tail = 0;
    this.length = 0;
  }

  /** Removes every entry without releasing memory. */
  clear() {
    this.head = 0;
    this.tail = 0;
    this.length = 0;
  }

  /** @private */
  grow() {
    const newCap = this.capacity * 2;
    const next = new Int32Array(newCap * this.stride);
    const s = this.stride;
    for (let i = 0; i < this.length; i++) {
      const src = ((this.head + i) % this.capacity) * s;
      for (let k = 0; k < s; k++) next[i * s + k] = this.data[src + k];
    }
    this.data = next;
    this.capacity = newCap;
    this.head = 0;
    this.tail = this.length;
  }

  /**
   * Pushes a 1-4 value tuple. Unused values are ignored beyond `stride`.
   * @param {number} a
   * @param {number} [b]
   * @param {number} [c]
   * @param {number} [d]
   */
  push(a, b = 0, c = 0, d = 0) {
    if (this.length === this.capacity) this.grow();
    const o = this.tail * this.stride;
    const data = this.data;
    data[o] = a;
    if (this.stride > 1) data[o + 1] = b;
    if (this.stride > 2) data[o + 2] = c;
    if (this.stride > 3) data[o + 3] = d;
    this.tail = (this.tail + 1) % this.capacity;
    this.length++;
  }

  /**
   * Pops the oldest entry into `out` (an array of at least `stride` length).
   * @param {Int32Array|number[]} out
   * @returns {boolean} false when the queue was empty
   */
  pop(out) {
    if (this.length === 0) return false;
    const o = this.head * this.stride;
    for (let k = 0; k < this.stride; k++) out[k] = this.data[o + k];
    this.head = (this.head + 1) % this.capacity;
    this.length--;
    return true;
  }
}

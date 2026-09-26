/**
 * Generic object pool that recycles instances to avoid GC pressure in hot
 * paths (particles, geometry buffers, chunk arrays).
 * @template T
 */
export class ObjectPool {
  /**
   * @param {() => T} create factory for new instances
   * @param {(obj: T) => void} [reset] called when an object is released
   * @param {number} [maxSize=Infinity] maximum retained free objects
   */
  constructor(create, reset = null, maxSize = Infinity) {
    this.create = create;
    this.reset = reset;
    this.maxSize = maxSize;
    /** @type {T[]} */
    this.free = [];
    this.created = 0;
  }

  /**
   * Returns a pooled or freshly created instance.
   * @returns {T}
   */
  acquire() {
    if (this.free.length > 0) return this.free.pop();
    this.created++;
    return this.create();
  }

  /**
   * Returns an instance to the pool.
   * @param {T} obj
   */
  release(obj) {
    if (this.reset) this.reset(obj);
    if (this.free.length < this.maxSize) this.free.push(obj);
  }

  /** Drops all retained free objects. */
  clear() {
    this.free.length = 0;
  }
}

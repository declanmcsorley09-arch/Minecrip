/**
 * Least-recently-used cache backed by a Map (which preserves insertion order).
 * @template K, V
 */
export class LRUCache {
  /**
   * @param {number} capacity maximum number of entries
   * @param {(key: K, value: V) => void} [onEvict] called when an entry is evicted
   */
  constructor(capacity, onEvict = null) {
    this.capacity = capacity;
    this.onEvict = onEvict;
    /** @type {Map<K, V>} */
    this.map = new Map();
  }

  /** @returns {number} */
  get size() {
    return this.map.size;
  }

  /**
   * Returns and refreshes an entry.
   * @param {K} key
   * @returns {V|undefined}
   */
  get(key) {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  /**
   * @param {K} key
   * @returns {boolean}
   */
  has(key) {
    return this.map.has(key);
  }

  /**
   * Inserts or refreshes an entry, evicting the oldest when over capacity.
   * @param {K} key
   * @param {V} value
   */
  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const oldestKey = this.map.keys().next().value;
      const oldest = this.map.get(oldestKey);
      this.map.delete(oldestKey);
      if (this.onEvict) this.onEvict(oldestKey, oldest);
    }
  }

  /**
   * Removes an entry and returns it (without calling onEvict).
   * @param {K} key
   * @returns {V|undefined}
   */
  take(key) {
    const value = this.map.get(key);
    this.map.delete(key);
    return value;
  }

  /** Removes all entries, calling onEvict for each. */
  clear() {
    if (this.onEvict) for (const [k, v] of this.map) this.onEvict(k, v);
    this.map.clear();
  }
}

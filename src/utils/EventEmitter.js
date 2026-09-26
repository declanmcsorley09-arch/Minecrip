/**
 * Minimal synchronous event emitter used for decoupled communication between
 * systems (settings changes, world events, UI actions).
 */
export class EventEmitter {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this.listeners = new Map();
  }

  /**
   * Subscribes to an event.
   * @param {string} event
   * @param {Function} fn
   * @returns {() => void} unsubscribe function
   */
  on(event, fn) {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn);
    return () => this.off(event, fn);
  }

  /**
   * Subscribes to a single emission.
   * @param {string} event
   * @param {Function} fn
   * @returns {() => void}
   */
  once(event, fn) {
    const wrapper = (...args) => {
      this.off(event, wrapper);
      fn(...args);
    };
    return this.on(event, wrapper);
  }

  /**
   * Removes a listener.
   * @param {string} event
   * @param {Function} fn
   */
  off(event, fn) {
    const set = this.listeners.get(event);
    if (set) set.delete(fn);
  }

  /**
   * Emits an event to all listeners.
   * @param {string} event
   * @param {...any} args
   */
  emit(event, ...args) {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of [...set]) fn(...args);
  }

  /** Removes every listener. */
  removeAllListeners() {
    this.listeners.clear();
  }
}

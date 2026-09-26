/**
 * Lightweight frame profiler: accumulates smoothed durations of named
 * sections of the frame (shown in the F3 debug overlay).
 */
export class Profiler {
  constructor() {
    /** @type {Map<string, number>} smoothed milliseconds per section */
    this.sections = new Map();
    this.stack = [];
    this.enabled = true;
  }

  /**
   * Starts timing a section.
   * @param {string} name
   */
  begin(name) {
    if (!this.enabled) return;
    this.stack.push(name, performance.now());
  }

  /** Ends the most recently started section. */
  end() {
    if (!this.enabled || this.stack.length === 0) return;
    const start = this.stack.pop();
    const name = this.stack.pop();
    const ms = performance.now() - start;
    const prev = this.sections.get(name) ?? ms;
    this.sections.set(name, prev + (ms - prev) * 0.1);
  }

  /**
   * Sections sorted by cost.
   * @param {number} [limit=8]
   * @returns {[string, number][]}
   */
  top(limit = 8) {
    return [...this.sections.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  }
}

/**
 * requestAnimationFrame driver with delta clamping, optional frame-rate cap
 * and a smoothed FPS counter.
 */
export class GameLoop {
  /**
   * @param {(dt: number, now: number) => void} frame callback
   */
  constructor(frame) {
    this.frame = frame;
    this.running = false;
    this.last = 0;
    this.maxFps = 0;
    this.fps = 0;
    this.frameTime = 0;
    this.frames = 0;
    this.fpsTimer = 0;
    this.handle = 0;
    this.tick = (now) => this.step(now);
  }

  /** Starts the loop. */
  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.handle = requestAnimationFrame(this.tick);
  }

  /** Stops the loop. */
  stop() {
    this.running = false;
    cancelAnimationFrame(this.handle);
  }

  /** @private */
  step(now) {
    if (!this.running) return;
    this.handle = requestAnimationFrame(this.tick);
    const elapsed = now - this.last;
    if (this.maxFps > 0 && elapsed < 1000 / this.maxFps - 1) return;
    this.last = now;
    const dt = Math.min(elapsed / 1000, 0.1);
    const start = performance.now();
    this.frame(dt, now);
    this.frameTime += (performance.now() - start - this.frameTime) * 0.1;
    this.frames++;
    this.fpsTimer += elapsed;
    if (this.fpsTimer >= 500) {
      this.fps = Math.round((this.frames * 1000) / this.fpsTimer);
      this.frames = 0;
      this.fpsTimer = 0;
    }
  }
}

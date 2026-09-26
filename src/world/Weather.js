import { clamp } from '../utils/math.js';

/**
 * Global weather state machine (clear → rain → thunder...). Intensities ramp
 * smoothly toward their targets so transitions are gradual. Whether a
 * column receives rain or snow is decided by its biome at render time.
 * Pure logic shared by client and server.
 */

/** Weather types. */
export const WeatherType = Object.freeze({
  CLEAR: 'clear',
  RAIN: 'rain',
  THUNDER: 'thunder',
});

export class Weather {
  /**
   * @param {() => number} [random] uniform random source
   */
  constructor(random = Math.random) {
    this.random = random;
    this.type = WeatherType.CLEAR;
    /** Current precipitation intensity 0..1. */
    this.rain = 0;
    /** Current thunder intensity 0..1. */
    this.thunder = 0;
    /** Seconds until the next automatic change. */
    this.timer = 300 + random() * 600;
    /** Disable to freeze the current weather. */
    this.cycle = true;
    /** Seconds until the next lightning strike (thunderstorms). */
    this.lightningTimer = 5;
    /** Set for one update when lightning strikes. */
    this.lightningStruck = false;
  }

  /**
   * Forces a weather type.
   * @param {string} type one of {@link WeatherType}
   * @param {number} [duration] seconds before the cycle resumes
   */
  set(type, duration) {
    this.type = type;
    this.timer = duration ?? (type === WeatherType.CLEAR ? 400 + this.random() * 600 : 180 + this.random() * 300);
  }

  /**
   * Advances weather transitions.
   * @param {number} dt seconds
   */
  update(dt) {
    this.lightningStruck = false;
    if (this.cycle) {
      this.timer -= dt;
      if (this.timer <= 0) {
        if (this.type === WeatherType.CLEAR) this.set(this.random() < 0.2 ? WeatherType.THUNDER : WeatherType.RAIN);
        else this.set(WeatherType.CLEAR);
      }
    }
    const rainTarget = this.type === WeatherType.CLEAR ? 0 : 1;
    const thunderTarget = this.type === WeatherType.THUNDER ? 1 : 0;
    const rate = dt / 12; // ~12 second transitions
    this.rain = clamp(this.rain + Math.sign(rainTarget - this.rain) * rate, 0, 1);
    if (Math.abs(this.rain - rainTarget) < rate) this.rain = rainTarget;
    this.thunder = clamp(this.thunder + Math.sign(thunderTarget - this.thunder) * rate, 0, 1);
    if (Math.abs(this.thunder - thunderTarget) < rate) this.thunder = thunderTarget;

    if (this.thunder > 0.5) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningStruck = true;
        this.lightningTimer = 4 + this.random() * 14;
      }
    }
  }

  /**
   * Serialisable snapshot.
   * @returns {{type:string, rain:number, thunder:number, timer:number}}
   */
  toJSON() {
    return { type: this.type, rain: this.rain, thunder: this.thunder, timer: this.timer };
  }

  /**
   * Restores from {@link Weather#toJSON}.
   * @param {{type:string, rain:number, thunder:number, timer:number}} data
   */
  fromJSON(data) {
    if (!data) return;
    this.type = data.type ?? WeatherType.CLEAR;
    this.rain = data.rain ?? 0;
    this.thunder = data.thunder ?? 0;
    this.timer = data.timer ?? 300;
  }
}

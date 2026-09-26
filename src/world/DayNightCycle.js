import { clamp, smoothstep } from '../utils/math.js';

/**
 * World clock. Time is measured in ticks (20 per second); a full day is
 * 24000 ticks. Tick 0 is sunrise, 6000 noon, 12000 sunset, 18000 midnight.
 * Pure logic shared by client and server.
 */

/** Ticks in one full day. */
export const DAY_TICKS = 24000;
/** Simulation ticks per real second. */
export const TICKS_PER_SECOND = 20;

export class DayNightCycle {
  /**
   * @param {number} [time=1000] initial absolute time in ticks
   */
  constructor(time = 1000) {
    this.time = time;
    /** Speed multiplier (1 = 20 minute days). */
    this.speed = 1;
    /** When false the clock is frozen. */
    this.running = true;
  }

  /**
   * Advances the clock.
   * @param {number} dt seconds
   */
  update(dt) {
    if (this.running) this.time += dt * TICKS_PER_SECOND * this.speed;
  }

  /** Time within the current day (0..24000). */
  get dayTime() {
    return ((this.time % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
  }

  /** Number of completed days. */
  get day() {
    return Math.floor(this.time / DAY_TICKS);
  }

  /**
   * Sets the time of day, keeping the day counter.
   * @param {number} ticks 0..24000
   */
  setDayTime(ticks) {
    this.time = this.day * DAY_TICKS + (((ticks % DAY_TICKS) + DAY_TICKS) % DAY_TICKS);
  }

  /** Angle of the sun around the sky in radians (0 = rising in the east). */
  get sunAngle() {
    return (this.dayTime / DAY_TICKS) * Math.PI * 2;
  }

  /** Sun elevation, -1 (midnight) .. 1 (noon). */
  get sunElevation() {
    return Math.sin(this.sunAngle);
  }

  /**
   * Direction toward the sun (unit vector), written into `out`.
   * @param {{x:number,y:number,z:number}} out
   * @returns {{x:number,y:number,z:number}}
   */
  sunDirection(out) {
    const a = this.sunAngle;
    const x = Math.cos(a);
    const y = Math.sin(a);
    const z = 0.28;
    const len = Math.hypot(x, y, z);
    out.x = x / len;
    out.y = y / len;
    out.z = z / len;
    return out;
  }

  /** 0 at night, 1 in full daylight, smooth through dawn and dusk. */
  get daylight() {
    return smoothstep(-0.12, 0.28, this.sunElevation);
  }

  /**
   * Multiplier applied to sky light for gameplay (mob spawning, rendering):
   * 1 at noon, ~0.2 at midnight.
   */
  get skyLightFactor() {
    return clamp(0.2 + 0.8 * this.daylight, 0, 1);
  }

  /** Moon phase 0..7 (0 = full moon). */
  get moonPhase() {
    return ((this.day % 8) + 8) % 8;
  }

  /** Whether it is night (hostile mobs spawn, undead stop burning). */
  get isNight() {
    return this.sunElevation < -0.05;
  }

  /**
   * Formats the time of day as HH:MM.
   * @returns {string}
   */
  formatClock() {
    const hours = (this.dayTime / 1000 + 6) % 24;
    const h = Math.floor(hours);
    const m = Math.floor((hours - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}

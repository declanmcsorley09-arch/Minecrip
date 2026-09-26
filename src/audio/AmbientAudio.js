import { blockRegistry } from '../blocks/index.js';

/**
 * Environmental sound beds: wind (stronger outdoors and at altitude), rain
 * (following how exposed the player is and muffled indoors), nearby water
 * and a low drone in deep caves. Loops are started once and only their
 * gains/filters change.
 */
export class AmbientAudio {
  /**
   * @param {import('./AudioEngine.js').AudioEngine} engine
   */
  constructor(engine) {
    this.engine = engine;
    this.loops = null;
    this.waterTimer = 0;
    this.waterLevel = 0;
    this.caveTimer = 0;
  }

  /** @private */
  ensureLoops() {
    if (this.loops || !this.engine.ready) return;
    this.loops = {
      wind: this.engine.loop('wind'),
      rain: this.engine.loop('rain'),
      water: this.engine.loop('water'),
      cave: this.engine.loop('cave'),
    };
  }

  /**
   * @param {number} dt
   * @param {object} env
   * @param {import('../world/World.js').World} env.world
   * @param {{x:number,y:number,z:number}} env.position listener position
   * @param {number} env.rainExposure 0..1 from the weather renderer
   * @param {number} env.rainFraction share of rain vs snow
   * @param {number} env.thunder 0..1
   * @param {boolean} env.underwater
   */
  update(dt, { world, position, rainExposure, rainFraction, thunder, underwater }) {
    this.ensureLoops();
    if (!this.loops) return;
    const x = Math.floor(position.x);
    const y = Math.floor(position.y);
    const z = Math.floor(position.z);
    const sky = world.getSkyLight(x, y, z) / 15;
    const altitude = Math.max(0, Math.min(1, (y - 70) / 60));
    const storm = rainExposure * (1 + thunder * 0.5);
    this.loops.wind.setVolume(underwater ? 0 : (0.08 + altitude * 0.35 + storm * 0.2) * sky, 1.2);
    this.loops.rain.setVolume(underwater ? 0 : Math.min(0.75, rainExposure * rainFraction * 1.4 + (sky < 0.8 ? rainExposure * 0.3 : 0)), 0.8);
    this.loops.rain.setFilter(sky > 0.9 ? 12000 : 1400);

    this.waterTimer -= dt;
    if (this.waterTimer <= 0) {
      this.waterTimer = 0.75;
      let count = 0;
      for (let dx = -6; dx <= 6; dx += 2) {
        for (let dz = -6; dz <= 6; dz += 2) {
          for (let dy = -3; dy <= 2; dy++) {
            const id = world.getBlock(x + dx, y + dy, z + dz);
            if (blockRegistry.fluid[id] && world.getBlock(x + dx, y + dy + 1, z + dz) === 0) count++;
          }
        }
      }
      this.waterLevel = Math.min(1, count / 20);
    }
    this.loops.water.setVolume(underwater ? 0.25 : this.waterLevel * 0.35, 1);

    const deep = sky < 0.15 && y < 50 ? Math.min(1, (50 - y) / 30) : 0;
    this.loops.cave.setVolume(deep * 0.5, 2);
    this.caveTimer -= dt;
    if (deep > 0.3 && this.caveTimer <= 0) {
      this.caveTimer = 40 + Math.random() * 80;
      this.engine.play('mob.zombie.ambient', {
        position: { x: position.x + (Math.random() - 0.5) * 30, y: position.y - 5, z: position.z + (Math.random() - 0.5) * 30 },
        volume: 0.25,
        pitch: 0.5,
        category: 'ambient',
        reverb: 0.8,
      });
    }
  }

  /** Stops every loop. */
  dispose() {
    if (!this.loops) return;
    for (const l of Object.values(this.loops)) if (l) l.stop();
    this.loops = null;
  }
}

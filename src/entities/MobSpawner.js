import { blockRegistry, BlockIds } from '../blocks/index.js';
import { ENTITY_TYPES, SPAWNABLE } from './EntityTypes.js';
import { BIOMES } from '../terrain/Biomes.js';

/**
 * Natural mob spawning and despawning around players.
 *
 * - Passive animals spawn in small herds on grass in well-lit areas.
 * - Hostile mobs spawn where the effective light level is 7 or less (open
 *   ground at night, caves at any time), never too close to a player.
 * - Hostile mobs despawn when far from every player.
 */

const PASSIVE_CAP = 10;
const HOSTILE_CAP = 12;
const MIN_SPAWN_DIST = 24;
const MAX_SPAWN_DIST = 56;

export class MobSpawner {
  /**
   * @param {import('./ai/Pathfinder.js').Pathfinder} pathfinder
   */
  constructor(pathfinder) {
    this.pathfinder = pathfinder;
    this.passiveTimer = 2;
    this.hostileTimer = 1;
    this.enabled = true;
  }

  /**
   * @param {number} dt
   * @param {import('./Entity.js').EntityContext} ctx
   * @param {{peaceful?: boolean}} rules
   */
  tick(dt, ctx, rules = {}) {
    this.despawn(dt, ctx);
    if (!this.enabled) return;
    this.passiveTimer -= dt;
    this.hostileTimer -= dt;
    for (const player of ctx.players) {
      if (player.dead) continue;
      if (this.passiveTimer <= 0 && ctx.entities.countCategory('passive', player.x, player.z, 72) < PASSIVE_CAP) {
        this.trySpawnPassive(ctx, player);
      }
      if (!rules.peaceful && this.hostileTimer <= 0 && ctx.entities.countCategory('hostile', player.x, player.z, 72) < HOSTILE_CAP) {
        this.trySpawnHostile(ctx, player);
      }
    }
    if (this.passiveTimer <= 0) this.passiveTimer = 6;
    if (this.hostileTimer <= 0) this.hostileTimer = 1.5;
    if (rules.peaceful) {
      for (const e of ctx.entities.entities.values()) if (e.category === 'hostile') e.remove();
    }
  }

  /** @private */
  randomColumn(ctx, player) {
    const a = ctx.random() * Math.PI * 2;
    const d = MIN_SPAWN_DIST + ctx.random() * (MAX_SPAWN_DIST - MIN_SPAWN_DIST);
    return { x: Math.floor(player.x + Math.cos(a) * d), z: Math.floor(player.z + Math.sin(a) * d) };
  }

  /** Whether a mob of the given height fits standing at (x, y, z). @private */
  fits(world, x, y, z, height) {
    const below = world.getBlock(x, y - 1, z);
    const belowDef = blockRegistry.byId[below];
    if (!belowDef || !belowDef.collision || blockRegistry.fluid[below] || below === BlockIds.cactus) return false;
    for (let i = 0; i < Math.ceil(height); i++) {
      const id = world.getBlock(x, y + i, z);
      if (id !== 0 && (blockRegistry.byId[id].collision || blockRegistry.fluid[id])) return false;
    }
    return true;
  }

  /** @private */
  trySpawnPassive(ctx, player) {
    const { x, z } = this.randomColumn(ctx, player);
    if (!ctx.world.isLoaded(x, z)) return;
    const y = ctx.world.getHeight(x, z);
    if (ctx.world.getBlock(x, y - 1, z) !== BlockIds.grass_block) return;
    if (ctx.world.getSkyLight(x, y, z) < 9) return;
    const chunk = ctx.world.getChunk(x >> 4, z >> 4);
    const biome = BIOMES[chunk.biomes[(x & 15) | ((z & 15) << 4)]];
    if (biome && biome.precipitation === 'none') return;
    const type = SPAWNABLE.passive[Math.floor(ctx.random() * SPAWNABLE.passive.length)];
    const herd = 2 + Math.floor(ctx.random() * 3);
    for (let i = 0; i < herd; i++) {
      const hx = x + Math.floor((ctx.random() - 0.5) * 6);
      const hz = z + Math.floor((ctx.random() - 0.5) * 6);
      if (!ctx.world.isLoaded(hx, hz)) continue;
      const hy = ctx.world.getHeight(hx, hz);
      if (ctx.world.getBlock(hx, hy - 1, hz) !== BlockIds.grass_block) continue;
      if (!this.fits(ctx.world, hx, hy, hz, ENTITY_TYPES[type].height)) continue;
      this.spawn(ctx, type, hx + 0.5, hy, hz + 0.5);
    }
  }

  /** @private */
  trySpawnHostile(ctx, player) {
    const { x, z } = this.randomColumn(ctx, player);
    if (!ctx.world.isLoaded(x, z)) return;
    const top = ctx.world.getHeight(x, z);
    // Either on the surface or somewhere in the caves below it.
    const y = ctx.random() < 0.5 ? top : 5 + Math.floor(ctx.random() * Math.max(1, top - 5));
    const type = SPAWNABLE.hostile[Math.floor(ctx.random() * SPAWNABLE.hostile.length)];
    const info = ENTITY_TYPES[type];
    if (!this.fits(ctx.world, x, y, z, info.height)) return;
    const light = ctx.world.getEffectiveLight(x, y, z, ctx.cycle.skyLightFactor);
    if (light > 7) return;
    for (const p of ctx.players) {
      if ((p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2 < MIN_SPAWN_DIST * MIN_SPAWN_DIST) return;
    }
    this.spawn(ctx, type, x + 0.5, y, z + 0.5);
  }

  /**
   * Spawns a mob of a type at a position.
   * @param {import('./Entity.js').EntityContext} ctx
   * @param {string} type
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {import('./Mob.js').Mob}
   */
  spawn(ctx, type, x, y, z) {
    const mob = ENTITY_TYPES[type].create(this.pathfinder);
    mob.setPosition(x, y, z);
    mob.yaw = ctx.random() * Math.PI * 2;
    ctx.entities.add(mob);
    return mob;
  }

  /** @private */
  despawn(dt, ctx) {
    for (const e of ctx.entities.entities.values()) {
      if (!e.canDespawn() || e.removed) continue;
      let nearest = Infinity;
      for (const p of ctx.players) nearest = Math.min(nearest, e.distanceSq(p.x, p.y, p.z));
      if (nearest > 128 * 128) e.remove();
      else if (nearest > 48 * 48) {
        e.idleTime += dt;
        if (e.idleTime > 30 && ctx.random() < dt / 20) e.remove();
      } else e.idleTime = 0;
    }
  }
}

import { LivingEntity } from './LivingEntity.js';
import { GoalSelector } from './ai/Goals.js';
import { PathNavigator } from './ai/PathNavigator.js';
import { itemRegistry } from '../items/index.js';

/**
 * Base class for AI-driven creatures. Subclasses configure stats, goals and
 * loot; this class wires the goal selectors, pathfinding navigator, ambient
 * sounds and the head/body look state sent in snapshots.
 */
export class Mob extends LivingEntity {
  /**
   * @param {string} type
   * @param {object} physics
   * @param {object} stats
   * @param {number} stats.health
   * @param {'passive'|'hostile'} stats.category
   * @param {{item:string, min:number, max:number}[]} [stats.loot]
   * @param {import('./ai/Pathfinder.js').Pathfinder} pathfinder
   */
  constructor(type, physics, stats, pathfinder) {
    super(type, physics, stats.health);
    this.category = stats.category;
    this.loot = stats.loot ?? [];
    this.goals = new GoalSelector();
    this.lookGoals = new GoalSelector();
    this.navigator = new PathNavigator(this, pathfinder);
    this.headYaw = null;
    this.ambientTimer = 5 + Math.random() * 10;
    this.pathBudget = 600;
  }

  /**
   * Nearest player within range.
   * @param {import('./Entity.js').EntityContext} ctx
   * @param {number} range
   * @param {boolean} hostile only targetable (survival, alive) players
   * @returns {import('../networking/ServerPlayer.js').ServerPlayer|null}
   */
  nearestPlayer(ctx, range, hostile) {
    let best = null;
    let bestD = range * range;
    for (const p of ctx.players) {
      if (hostile ? !p.canBeTargeted() : p.dead) continue;
      const d = this.distanceSq(p.x, p.y, p.z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /** @override */
  aiStep(dt, ctx) {
    this.wishX = 0;
    this.wishZ = 0;
    this.goals.tick(dt, ctx);
    this.lookGoals.tick(dt, ctx);
    this.navigator.tick(dt);
    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0) {
      this.ambientTimer = 8 + ctx.random() * 12;
      ctx.emitEvent(this, 'ambient');
    }
  }

  /** @override */
  dropLoot(ctx) {
    for (const drop of this.loot) {
      const count = drop.min + Math.floor(ctx.random() * (drop.max - drop.min + 1));
      if (count <= 0) continue;
      const item = itemRegistry.getByName(drop.item);
      if (!item) continue;
      ctx.spawnItem(
        { id: item.id, count },
        this.x, this.y + 0.5, this.z,
        (ctx.random() - 0.5) * 3, 4, (ctx.random() - 0.5) * 3,
      );
    }
  }

  /** @override */
  snapshotData() {
    return { h: this.health, hy: this.headYaw === null ? null : Math.round(this.headYaw * 1000) / 1000 };
  }

  /** @override */
  canDespawn() {
    return this.category === 'hostile';
  }
}

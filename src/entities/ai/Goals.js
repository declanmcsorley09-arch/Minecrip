import { raycastVoxels } from '../../physics/VoxelRaycast.js';

/**
 * Goal-based mob AI. A {@link GoalSelector} runs the highest-priority goal
 * whose start condition holds; lower numbers mean higher priority. Movement
 * and looking are separate selectors so a mob can wander while glancing at
 * a nearby player.
 */

export class Goal {
  /**
   * @param {import('../Mob.js').Mob} mob
   */
  constructor(mob) {
    this.mob = mob;
  }

  /** @returns {boolean} */
  canStart(_ctx) {
    return false;
  }

  /** @returns {boolean} */
  canContinue(ctx) {
    return this.canStart(ctx);
  }

  start(_ctx) {}

  stop(_ctx) {}

  tick(_dt, _ctx) {}
}

export class GoalSelector {
  constructor() {
    /** @type {{priority:number, goal:Goal}[]} */
    this.goals = [];
    /** @type {Goal|null} */
    this.current = null;
    this.currentPriority = Infinity;
  }

  /**
   * @param {number} priority lower runs first
   * @param {Goal} goal
   */
  add(priority, goal) {
    this.goals.push({ priority, goal });
    this.goals.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Re-evaluates goals and ticks the active one.
   * @param {number} dt
   * @param {import('../Entity.js').EntityContext} ctx
   */
  tick(dt, ctx) {
    if (this.current && !this.current.canContinue(ctx)) {
      this.current.stop(ctx);
      this.current = null;
      this.currentPriority = Infinity;
    }
    for (const { priority, goal } of this.goals) {
      if (priority >= this.currentPriority) break;
      if (goal !== this.current && goal.canStart(ctx)) {
        if (this.current) this.current.stop(ctx);
        this.current = goal;
        this.currentPriority = priority;
        goal.start(ctx);
        break;
      }
    }
    if (this.current) this.current.tick(dt, ctx);
  }
}

/**
 * Picks a random nearby spot and walks there.
 */
export class WanderGoal extends Goal {
  /**
   * @param {import('../Mob.js').Mob} mob
   * @param {number} speed
   * @param {number} [chance=0.12] start probability per second
   */
  constructor(mob, speed, chance = 0.12) {
    super(mob);
    this.speed = speed;
    this.chance = chance;
    this.timeout = 0;
  }

  canStart(ctx) {
    return ctx.random() < this.chance * ctx.dt;
  }

  canContinue() {
    return this.mob.navigator.active && this.timeout > 0;
  }

  start(ctx) {
    const m = this.mob;
    for (let attempt = 0; attempt < 6; attempt++) {
      const tx = Math.floor(m.x + (ctx.random() - 0.5) * 20);
      const tz = Math.floor(m.z + (ctx.random() - 0.5) * 20);
      const ty = ctx.world.getHeight(tx, tz);
      if (Math.abs(ty - m.y) > 6) continue;
      if (m.navigator.moveTo(tx, ty, tz, this.speed)) break;
    }
    this.timeout = 12;
  }

  tick(dt) {
    this.timeout -= dt;
  }

  stop() {
    this.mob.navigator.stop();
  }
}

/**
 * Runs away from the last attacker after being hurt.
 */
export class PanicGoal extends Goal {
  constructor(mob, speed) {
    super(mob);
    this.speed = speed;
    this.timer = 0;
  }

  canStart() {
    return this.mob.sinceHurt < 0.2;
  }

  canContinue() {
    return this.timer > 0;
  }

  start(ctx) {
    this.timer = 4 + ctx.random() * 2;
    this.flee(ctx);
  }

  /** @private */
  flee(ctx) {
    const m = this.mob;
    const from = m.lastAttackerPos ?? { x: m.x + ctx.random() - 0.5, z: m.z + ctx.random() - 0.5 };
    let dx = m.x - from.x;
    let dz = m.z - from.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const tx = Math.floor(m.x + dx * 10 + (ctx.random() - 0.5) * 6);
    const tz = Math.floor(m.z + dz * 10 + (ctx.random() - 0.5) * 6);
    m.navigator.moveTo(tx, ctx.world.getHeight(tx, tz), tz, this.speed);
  }

  tick(dt, ctx) {
    this.timer -= dt;
    if (!this.mob.navigator.active) this.flee(ctx);
    if (this.mob.sinceHurt < 0.2) this.flee(ctx);
  }

  stop() {
    this.mob.navigator.stop();
  }
}

/**
 * Turns the head toward a nearby player for a few seconds.
 */
export class LookAtPlayerGoal extends Goal {
  constructor(mob, range = 8) {
    super(mob);
    this.range = range;
    this.timer = 0;
    this.player = null;
  }

  canStart(ctx) {
    if (ctx.random() > 0.02) return false;
    this.player = this.mob.nearestPlayer(ctx, this.range, false);
    return !!this.player;
  }

  canContinue() {
    return this.timer > 0 && !!this.player;
  }

  start(ctx) {
    this.timer = 2 + ctx.random() * 3;
  }

  tick(dt) {
    this.timer -= dt;
    const p = this.player;
    const m = this.mob;
    m.headYaw = Math.atan2(-(p.x - m.x), -(p.z - m.z));
    m.pitch = -Math.atan2(p.y + 1.5 - (m.y + m.eyeHeight), Math.hypot(p.x - m.x, p.z - m.z));
  }

  stop() {
    this.mob.headYaw = null;
    this.mob.pitch = 0;
  }
}

/**
 * Chases the nearest survival player and hits it in melee range.
 */
export class MeleeAttackGoal extends Goal {
  /**
   * @param {import('../Mob.js').Mob} mob
   * @param {number} speed
   * @param {number} damage
   * @param {number} [range=24] follow range
   */
  constructor(mob, speed, damage, range = 24) {
    super(mob);
    this.speed = speed;
    this.damage = damage;
    this.range = range;
    this.cooldown = 0;
    this.repath = 0;
    this.target = null;
  }

  canStart(ctx) {
    this.target = this.mob.nearestPlayer(ctx, this.range, true);
    return !!this.target;
  }

  canContinue(ctx) {
    const t = this.target;
    return !!t && t.canBeTargeted() && this.mob.distanceSq(t.x, t.y, t.z) < (this.range + 8) ** 2 && !ctx.isRemoved(t);
  }

  start() {
    this.repath = 0;
  }

  tick(dt, ctx) {
    const m = this.mob;
    const t = this.target;
    this.cooldown -= dt;
    this.repath -= dt;
    const dist2 = m.distanceSq(t.x, t.y, t.z);
    m.lookYaw = Math.atan2(-(t.x - m.x), -(t.z - m.z));
    if (this.repath <= 0) {
      this.repath = dist2 < 16 ? 0.25 : 0.6;
      if (!m.navigator.moveTo(t.x, t.y, t.z, this.speed)) {
        // Direct approach when no path is found (e.g. open terrain edge cases).
        const d = Math.sqrt(dist2) || 1;
        m.wishX = ((t.x - m.x) / d) * this.speed;
        m.wishZ = ((t.z - m.z) / d) * this.speed;
      }
    }
    const reach = m.body.width * 0.5 + 1.1;
    if (dist2 < reach * reach + 1 && Math.abs(t.y - m.y) < 1.8 && this.cooldown <= 0) {
      this.cooldown = 1;
      m.attackAnim = 0.3;
      ctx.damagePlayer(t, this.damage, m, m.type);
      ctx.emitEvent(m, 'attack');
    }
  }

  stop() {
    this.mob.navigator.stop();
    this.mob.lookYaw = null;
  }
}

/**
 * Keeps a comfortable distance from the target and shoots arrows when it
 * has line of sight.
 */
export class RangedAttackGoal extends Goal {
  /**
   * @param {import('../Mob.js').Mob} mob
   * @param {number} speed
   * @param {number} [range=16]
   * @param {number} [interval=2]
   */
  constructor(mob, speed, range = 16, interval = 2) {
    super(mob);
    this.speed = speed;
    this.range = range;
    this.interval = interval;
    this.cooldown = 1;
    this.repath = 0;
    this.target = null;
  }

  canStart(ctx) {
    this.target = this.mob.nearestPlayer(ctx, this.range + 4, true);
    return !!this.target;
  }

  canContinue(ctx) {
    const t = this.target;
    return !!t && t.canBeTargeted() && this.mob.distanceSq(t.x, t.y, t.z) < (this.range + 10) ** 2 && !ctx.isRemoved(t);
  }

  tick(dt, ctx) {
    const m = this.mob;
    const t = this.target;
    this.cooldown -= dt;
    this.repath -= dt;
    const dx = t.x - m.x;
    const dz = t.z - m.z;
    const dist = Math.hypot(dx, dz);
    m.lookYaw = Math.atan2(-dx, -dz);
    const sees = this.hasLineOfSight(ctx, t);
    if (this.repath <= 0) {
      this.repath = 0.5;
      if (dist > this.range * 0.7 || !sees) m.navigator.moveTo(t.x, t.y, t.z, this.speed);
      else if (dist < 5) {
        const bx = Math.floor(m.x - (dx / dist) * 6);
        const bz = Math.floor(m.z - (dz / dist) * 6);
        m.navigator.moveTo(bx, ctx.world.getHeight(bx, bz), bz, this.speed);
      } else m.navigator.stop();
    }
    if (sees && dist < this.range && this.cooldown <= 0) {
      this.cooldown = this.interval;
      m.attackAnim = 0.5;
      m.shootAt(ctx, t);
    }
  }

  /** @private */
  hasLineOfSight(ctx, t) {
    const m = this.mob;
    const ox = m.x;
    const oy = m.y + m.eyeHeight;
    const oz = m.z;
    const tx = t.x - ox;
    const ty = t.y + 1.5 - oy;
    const tz = t.z - oz;
    const len = Math.hypot(tx, ty, tz);
    if (len < 0.001) return true;
    const hit = raycastVoxels(ctx.world, ox, oy, oz, tx / len, ty / len, tz / len, len);
    return !hit;
  }

  stop() {
    this.mob.navigator.stop();
    this.mob.lookYaw = null;
  }
}

/**
 * Burning undead look for shade during the day.
 */
export class SeekShadeGoal extends Goal {
  constructor(mob, speed) {
    super(mob);
    this.speed = speed;
  }

  canStart() {
    return this.mob.burnTime > 0;
  }

  canContinue() {
    return this.mob.burnTime > 0 && this.mob.navigator.active;
  }

  start(ctx) {
    const m = this.mob;
    for (let i = 0; i < 12; i++) {
      const x = Math.floor(m.x + (ctx.random() - 0.5) * 20);
      const z = Math.floor(m.z + (ctx.random() - 0.5) * 20);
      const y = Math.floor(m.y + (ctx.random() - 0.5) * 6);
      if (ctx.world.getSkyLight(x, y + 1, z) < 15 && ctx.world.getBlock(x, y, z) === 0 && ctx.world.getBlock(x, y + 1, z) === 0) {
        if (m.navigator.moveTo(x, y, z, this.speed)) return;
      }
    }
  }

  stop() {
    this.mob.navigator.stop();
  }
}

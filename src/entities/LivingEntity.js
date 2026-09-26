import { Entity } from './Entity.js';
import { EntityFlags } from '../networking/Protocol.js';
import { damp, angleDelta } from '../utils/math.js';

/**
 * An entity with health that can be hurt, knocked back, set on fire and
 * killed. Provides the desired-velocity movement model shared by all mobs.
 */
export class LivingEntity extends Entity {
  /**
   * @param {string} type
   * @param {object} physics
   * @param {number} maxHealth
   */
  constructor(type, physics, maxHealth) {
    super(type, physics);
    this.maxHealth = maxHealth;
    this.health = maxHealth;
    this.hurtTime = 0;
    this.invulnerable = 0;
    this.deathTime = 0;
    this.dead = false;
    this.burnTime = 0;
    this.fireTick = 0;
    /** Seconds since last damage (for panic behaviour). */
    this.sinceHurt = Infinity;
    /** @type {{x:number, z:number}|null} where the last damage came from */
    this.lastAttackerPos = null;
    /** Desired horizontal velocity set by AI. */
    this.wishX = 0;
    this.wishZ = 0;
    this.wantsJump = false;
    this.bodyYaw = 0;
    this.lookYaw = null;
    this.attackAnim = 0;
  }

  /**
   * Applies damage.
   * @param {number} amount
   * @param {EntityContextLike} ctx
   * @param {{x:number, z:number}|null} [source] attacker position (knockback)
   * @param {number} [knockback=1] knockback multiplier
   * @returns {boolean} whether damage was applied
   */
  hurt(amount, ctx, source = null, knockback = 1) {
    if (this.dead || this.invulnerable > 0) return false;
    this.health -= amount;
    this.hurtTime = 0.4;
    this.invulnerable = 0.5;
    this.sinceHurt = 0;
    if (source) {
      this.lastAttackerPos = { x: source.x, z: source.z };
      const dx = this.x - source.x;
      const dz = this.z - source.z;
      const len = Math.hypot(dx, dz) || 1;
      const v = this.body.velocity;
      v.x = (dx / len) * 6 * knockback;
      v.z = (dz / len) * 6 * knockback;
      v.y = Math.max(v.y, 5 * knockback);
    }
    ctx.emitEvent(this, 'hurt');
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      ctx.emitEvent(this, 'death');
      this.dropLoot(ctx);
    }
    return true;
  }

  /**
   * Spawns death drops.
   * @param {EntityContextLike} _ctx
   */
  dropLoot(_ctx) {}

  /**
   * Whether this entity burns in direct sunlight.
   * @returns {boolean}
   */
  burnsInDaylight() {
    return false;
  }

  /**
   * Turns the body toward a yaw at a limited rate.
   * @protected
   */
  turnTowards(targetYaw, dt, rate = 8) {
    this.yaw += angleDelta(this.yaw, targetYaw) * damp(rate, dt);
  }

  /** @override */
  tick(dt, ctx) {
    super.tick(dt, ctx);
    this.sinceHurt += dt;
    if (this.hurtTime > 0) this.hurtTime -= dt;
    if (this.invulnerable > 0) this.invulnerable -= dt;
    if (this.attackAnim > 0) this.attackAnim -= dt;
    if (this.dead) {
      this.deathTime += dt;
      const v = this.body.velocity;
      v.x *= Math.exp(-6 * dt);
      v.z *= Math.exp(-6 * dt);
      this.body.step(ctx.world, dt);
      if (this.deathTime > 1) this.remove();
      return;
    }

    // Undead catch fire in direct sunlight.
    if (this.burnsInDaylight() && ctx.cycle.daylight > 0.6 && this.body.submersion < 0.3) {
      const hx = Math.floor(this.x);
      const hy = Math.floor(this.y + this.eyeHeight);
      const hz = Math.floor(this.z);
      if (ctx.world.getSkyLight(hx, hy, hz) >= 15) this.burnTime = Math.max(this.burnTime, 3);
    }
    if (this.body.submersion > 0.3) this.burnTime = 0;
    if (this.burnTime > 0) {
      this.burnTime -= dt;
      this.fireTick += dt;
      if (this.fireTick >= 1) {
        this.fireTick = 0;
        this.invulnerable = 0;
        this.hurt(1, ctx, null, 0);
      }
    }

    this.aiStep(dt, ctx);
    this.applyMovement(dt, ctx);
  }

  /**
   * AI hook run before movement each tick.
   * @protected
   */
  aiStep(_dt, _ctx) {}

  /**
   * Accelerates toward the AI's wish velocity and integrates physics.
   * @protected
   */
  applyMovement(dt, ctx) {
    const body = this.body;
    const v = body.velocity;
    const inWater = body.submersion > 0.2;
    const k = body.onGround ? (this.sinceHurt < 0.3 ? 2 : 12) : inWater ? 4 : 1.5;
    const f = damp(k, dt);
    v.x += (this.wishX - v.x) * f;
    v.z += (this.wishZ - v.z) * f;
    if (inWater) {
      // Swim upward to stay afloat.
      if (body.submersion > 0.5) v.y = Math.max(v.y, 2.2);
      if (this.wantsJump && body.collidedHorizontally) v.y = 6;
    } else if (this.wantsJump && body.onGround) {
      v.y = 8.6;
    }
    this.wantsJump = false;
    body.step(ctx.world, dt);
    const speed2 = this.wishX * this.wishX + this.wishZ * this.wishZ;
    if (this.lookYaw !== null) this.turnTowards(this.lookYaw, dt, 10);
    else if (speed2 > 0.01) this.turnTowards(Math.atan2(-this.wishX, -this.wishZ), dt);
  }

  /** @override */
  snapshotFlags() {
    let f = super.snapshotFlags();
    if (this.hurtTime > 0) f |= EntityFlags.HURT;
    if (this.dead) f |= EntityFlags.DEAD;
    if (this.burnTime > 0) f |= EntityFlags.BURNING;
    if (this.attackAnim > 0) f |= EntityFlags.ATTACKING;
    return f;
  }

  /** @override */
  snapshotData() {
    return { h: this.health };
  }
}

/**
 * @typedef {import('./Entity.js').EntityContext} EntityContextLike
 */
